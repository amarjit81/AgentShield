import request from 'supertest';
import nodemailer from 'nodemailer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { startSession } from '../src/services/authService.js';
import { registerAgent, configureAgent } from '../src/services/agentService.js';
import { readEmailDeliveryConfig, createEmailTransport } from '../src/services/emailDelivery.js';
import { reviewPendingAction } from '../src/repositories/actionRepository.js';

// This file cannot contact a real mail server, even if local credentials exist.
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Use an isolated disposable database with AGENTSHIELD_TEST_DATABASE=1.');
const smtpEnv = { EMAIL_DELIVERY_MODE: 'SMTP', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'sender@example.com', SMTP_PASSWORD: 'test-secret', SMTP_FROM: 'sender@example.com', EMAIL_ALLOWED_RECIPIENTS: 'inbox@example.com,staff@agentshield.test,bad@blocked.example' };
const email = (target = 'inbox@example.com') => ({ agentId: 'SMTP-Agent', action: 'SEND_EMAIL', target, arguments: { subject: 'Exact subject', body: 'Exact body\nSecond line.' } });
let owner, manager, ownerAuth, managerAuth, sendMail, close;
const post = (path, body, auth = ownerAuth) => request(app).post(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken).send(body);
const get = (path, auth = ownerAuth) => request(app).get(path).set('Cookie', `agentshield_session=${auth.token}`);
async function approved(target) {
  const body = email(target);
  const created = await post('/api/actions', body).expect(201);
  if (created.body.status === 'PENDING_APPROVAL') await reviewPendingAction(created.body.requestId, 'APPROVED', manager);
  return { body, id: created.body.requestId };
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(smtpEnv)) vi.stubEnv(key, value);
  sendMail = vi.fn(async options => ({ accepted: [options.envelope.to[0]], rejected: [], messageId: options.messageId }));
  close = vi.fn(); nodemailer.createTransport.mockReturnValue({ sendMail, close });
  await prisma.refundPolicy.deleteMany(); await prisma.actionRequest.deleteMany(); await prisma.authSession.deleteMany(); await prisma.agent.deleteMany(); await prisma.user.deleteMany();
  owner = await prisma.user.create({ data: { email: 'smtp-owner@example.test', passwordHash: 'unused' } });
  manager = await prisma.user.create({ data: { email: 'smtp-manager@example.test', role: 'MANAGER', passwordHash: 'unused' } });
  await registerAgent({ agentId: 'SMTP-Agent', name: 'SMTP Agent', ownerEmail: owner.email, allowedTools: ['SEND_EMAIL'] });
  ownerAuth = await startSession(owner); managerAuth = await startSession(manager);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.actionRequest.deleteMany(); await prisma.$disconnect(); });

describe('Real email configuration and transport', () => {
  it('requires authentication and exposes only safe configuration fields', async () => {
    await request(app).get('/api/actions/email-delivery').expect(401);
    const result = await get('/api/actions/email-delivery').expect(200);
    expect(result.body).toEqual({ mode: 'SMTP', ready: true, from: smtpEnv.SMTP_FROM, allowedRecipients: smtpEnv.EMAIL_ALLOWED_RECIPIENTS.split(',') });
    expect(JSON.stringify(result.body)).not.toContain('test-secret');
    expect(JSON.stringify(result.body)).not.toContain('smtp.example.com');
  });

  it.each([
    ['SMTP_PASSWORD', ''], ['SMTP_FROM', 'x@example.com\r\nBcc:bad@example.com'],
    ['EMAIL_ALLOWED_RECIPIENTS', 'bad'],
    ['SMTP_PORT', '25'], ['SMTP_HOST', 'smtp://example.com'], ['EMAIL_DELIVERY_MODE', 'TYPO'],
  ])('fails closed for invalid %s without reserving or sending', async (key, value) => {
    vi.stubEnv(key, value);
    expect((await get('/api/actions/email-delivery')).body.ready).toBe(false);
    expect((await post('/api/actions', email()).expect(503)).body.error).toBe('EMAIL_NOT_CONFIGURED');
    expect(await prisma.actionRequest.count()).toBe(0); expect(sendMail).not.toHaveBeenCalled();
  });

  it.each([465, 587])('requires verified TLS and bounded timeouts on port %s', port => {
    createEmailTransport(readEmailDeliveryConfig({ ...smtpEnv, SMTP_PORT: String(port) }));
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port, secure: port === 465, requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
      connectionTimeout: 15000, socketTimeout: 30000,
    }));
  });

  it('allows a valid external address outside the demo suggestions, with Manager approval', async () => {
    const body = email('other@example.com');
    const created = await post('/api/actions', body).expect(201);
    expect(created.body.status).toBe('PENDING_APPROVAL');
    expect(sendMail).not.toHaveBeenCalled();
    await post(`/api/actions/${created.body.requestId}/review`, { decision: 'APPROVE' }, managerAuth).expect(200);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ envelope: { from: smtpEnv.SMTP_FROM, to: ['other@example.com'] } }));
  });
});

describe('Approved SMTP dispatch', () => {
  it('sends once as part of the Manager approval request', async () => {
    const body = email();
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    const reviewed = await post(`/api/actions/${id}/review`, { decision: 'APPROVE' }, managerAuth).expect(200);
    expect(reviewed.body).toMatchObject({ requestId: id, status: 'EXECUTED', approved: true });
    expect(sendMail).toHaveBeenCalledOnce();
    expect((await get(`/api/actions/${id}`)).body.execution.result.deliveryStatus).toBe('ACCEPTED');
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it('binds real delivery and sender to the approval and sends only the exact authorized message', async () => {
    const { id, body } = await approved();
    const saved = (await get(`/api/actions/${id}`)).body;
    expect(saved).toMatchObject({ executionMode: 'SMTP', emailSender: smtpEnv.SMTP_FROM });
    expect(saved.approval.snapshot).toEqual({ ...body, executionMode: 'SMTP', emailSender: smtpEnv.SMTP_FROM });
    expect(sendMail).not.toHaveBeenCalled();
    const response = await post(`/api/actions/${id}/execute`, body).expect(200);
    expect(response.body.execution.result).toMatchObject({ simulated: false, delivered: null, deliveryStatus: 'ACCEPTED', sender: smtpEnv.SMTP_FROM, recipient: body.target, ...body.arguments });
    expect(sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ from: { address: smtpEnv.SMTP_FROM }, to: [{ address: body.target }], envelope: { from: smtpEnv.SMTP_FROM, to: [body.target] }, subject: body.arguments.subject, text: body.arguments.body }));
    expect(close).toHaveBeenCalledOnce();
    expect((await get(`/api/actions/${id}/audit`)).body.events.map(event => event.event)).toEqual(['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'ACTION_REVIEWED', 'EMAIL_DISPATCH_RESERVED', 'EMAIL_ACCEPTED']);
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'blocked', 'rejected', 'tampered', 'revoked', 'inactive', 'outsider', 'csrf'])('does not contact SMTP for %s execution', async scenario => {
    const body = email(scenario === 'blocked' ? 'bad@blocked.example' : undefined);
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    if (scenario === 'rejected') await post(`/api/actions/${id}/review`, { decision: 'REJECT' }, managerAuth).expect(200);
    else if (scenario !== 'pending' && scenario !== 'blocked') await reviewPendingAction(id, 'APPROVED', manager);
    if (scenario === 'revoked' || scenario === 'inactive') await configureAgent({ agentId: body.agentId, status: scenario === 'inactive' ? 'inactive' : 'active', allowedTools: [] });
    if (scenario === 'tampered') body.arguments.body += ' altered';
    if (scenario === 'outsider') {
      const other = await prisma.user.create({ data: { email: 'other@example.test', passwordHash: 'unused' } });
      await post(`/api/actions/${id}/execute`, body, await startSession(other)).expect(404);
    } else if (scenario === 'csrf') {
      await request(app).post(`/api/actions/${id}/execute`).set('Cookie', `agentshield_session=${ownerAuth.token}`).send(body).expect(403);
    } else await post(`/api/actions/${id}/execute`, body).expect(['revoked', 'inactive'].includes(scenario) ? 403 : 409);
    expect(sendMail).not.toHaveBeenCalled(); expect(await prisma.executionRecord.count()).toBe(0);
  });

  it('commits a reservation before SMTP and refuses a competing call while the first is in flight', async () => {
    const { id, body } = await approved();
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    sendMail.mockImplementationOnce(async options => {
      const reservation = await prisma.executionRecord.findUnique({ where: { requestId: id } });
      expect(reservation.result.deliveryStatus).toBe('DISPATCHING');
      entered(); await new Promise(resolve => { release = resolve; });
      return { accepted: [body.target], rejected: [], messageId: options.messageId };
    });
    const first = post(`/api/actions/${id}/execute`, body).then(response => response);
    await started;
    const replay = await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(replay.body.error).toBe('EMAIL_ATTEMPT_EXISTS');
    release(); expect((await first).status).toBe(200); expect(sendMail).toHaveBeenCalledOnce();
  });

  it.each(['timeout', 'rejection'])('keeps a durable receipt after %s and never retries it', async failure => {
    const { id, body } = await approved();
    if (failure === 'timeout') sendMail.mockRejectedValueOnce(new Error('private provider error test-secret'));
    else sendMail.mockResolvedValueOnce({ accepted: [], rejected: [body.target] });
    const response = await post(`/api/actions/${id}/execute`, body).expect(502);
    expect(response.body).toMatchObject({ error: 'EMAIL_DELIVERY_UNKNOWN', status: 'FAILED', execution: { result: { deliveryStatus: 'UNKNOWN', delivered: null } } });
    expect(JSON.stringify(response.body)).not.toContain('test-secret');
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect((await get(`/api/actions/${id}`)).body.status).toBe('FAILED'); expect(sendMail).toHaveBeenCalledOnce();
  });

  it('does not resend if storage fails after SMTP acceptance', async () => {
    const { id, body } = await approved();
    sendMail.mockImplementationOnce(async options => {
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('Database unavailable after send'));
      return { accepted: [body.target], rejected: [], messageId: options.messageId };
    });
    expect((await post(`/api/actions/${id}/execute`, body).expect(503)).body.error).toBe('EMAIL_OUTCOME_UNKNOWN');
    expect((await get(`/api/actions/${id}`)).body.execution.result.deliveryStatus).toBe('DISPATCHING');
    await post(`/api/actions/${id}/execute`, body).expect(409); expect(sendMail).toHaveBeenCalledOnce();
  });

  it.each(['mode', 'sender'])('rechecks changed %s before reserving an attempt', async change => {
    const { id, body } = await approved();
    vi.stubEnv(change === 'mode' ? 'EMAIL_DELIVERY_MODE' : 'SMTP_FROM', change === 'mode' ? 'SIMULATED' : 'different@example.com');
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(await prisma.executionRecord.count()).toBe(0); expect(sendMail).not.toHaveBeenCalled();
  });

  it('keeps earlier simulated requests simulated after enabling SMTP', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'SIMULATED');
    const { id, body } = await approved('staff@agentshield.test');
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'SMTP');
    const result = await post(`/api/actions/${id}/execute`, body).expect(200);
    expect(result.body.execution.result).toMatchObject({ simulated: true, delivered: false });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not allow the client to choose a delivery mode or sender', async () => {
    await post('/api/actions', { ...email(), executionMode: 'SIMULATED', emailSender: 'attacker@example.com' }).expect(400);
    expect(await prisma.actionRequest.count()).toBe(0);
  });
});
