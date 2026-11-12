import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { startSession } from '../src/services/authService.js';
import { configureAgent, registerAgent } from '../src/services/agentService.js';
import * as simulator from '../src/services/emailSimulator.js';
import * as policy from '../src/services/emailPolicyService.js';
import { PolicyUnavailableError } from '../src/services/opaPolicy.js';

if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Use an isolated disposable database with AGENTSHIELD_TEST_DATABASE=1.');
let owner, manager, outsider, ownerAuth, managerAuth, outsiderAuth;
const email = (target = 'staff@agentshield.test') => ({ agentId: 'Email-Agent', action: 'SEND_EMAIL', target, arguments: { subject: 'Update', body: 'Project update.\nPlease review.' } });
const post = (path, body, auth = ownerAuth) => request(app).post(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken).send(body);
const get = (path, auth = ownerAuth) => request(app).get(path).set('Cookie', `agentshield_session=${auth.token}`);
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.refundPolicy.deleteMany();
  await prisma.actionRequest.deleteMany(); await prisma.authSession.deleteMany(); await prisma.agent.deleteMany(); await prisma.user.deleteMany();
  owner = await prisma.user.create({ data: { email: 'email-owner@example.test', role: 'USER', passwordHash: 'unused' } });
  manager = await prisma.user.create({ data: { email: 'email-manager@example.test', role: 'MANAGER', passwordHash: 'unused' } });
  outsider = await prisma.user.create({ data: { email: 'email-outsider@example.test', role: 'USER', passwordHash: 'unused' } });
  await registerAgent({ agentId: 'Email-Agent', name: 'Email Agent', ownerEmail: owner.email, allowedTools: ['SEND_EMAIL'] });
  ownerAuth = await startSession(owner); managerAuth = await startSession(manager); outsiderAuth = await startSession(outsider);
});
afterAll(async () => { await prisma.actionRequest.deleteMany(); await prisma.$disconnect(); });

describe('Email request, review, and simulator', () => {
  it('stores an internal decision and a nondelivery receipt with an audit trail', async () => {
    const body = email();
    const created = await post('/api/actions', body).expect(201);
    expect(created.body).toMatchObject({ action: 'SEND_EMAIL', decision: 'ALLOW', status: 'AUTHORIZED', policyVersion: 'opa-email-r1-v1' });
    const id = created.body.requestId;
    const executed = await post(`/api/actions/${id}/execute`, body).expect(200);
    expect(executed.body.execution.result).toMatchObject({ simulator: 'SEND_EMAIL', simulated: true, delivered: false, recipient: body.target, ...body.arguments });
    const saved = await get(`/api/actions/${id}`).expect(200);
    expect(saved.body.policyDecision.policy).toEqual({ version: 1, internalDomains: ['agentshield.test'], blockedDomains: ['blocked.example'] });
    expect(saved.body.arguments).toEqual(body.arguments);
    expect((await get(`/api/actions/${id}/audit`)).body.events.map(event => event.event)).toEqual(['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'EMAIL_SIMULATED']);
    expect((await prisma.policyDecision.findUnique({ where: { requestId: id } })).autoApproveLimit).toBeNull();
  });

  it('requires external approval, exposes full details in the queue, and binds the exact message', async () => {
    const body = email('customer@example.com');
    const { body: created } = await post('/api/actions', body).expect(201);
    expect(created.decision).toBe('REQUIRE_APPROVAL');
    await post(`/api/actions/${created.requestId}/execute`, body).expect(409);
    const queue = await get('/api/actions/pending', managerAuth).expect(200);
    expect(queue.body.requests[0]).toMatchObject({ action: 'SEND_EMAIL', target: body.target, arguments: body.arguments });
    await post(`/api/actions/${created.requestId}/review`, { decision: 'APPROVE' }).expect(403);
    await post(`/api/actions/${created.requestId}/review`, { decision: 'APPROVE' }, managerAuth).expect(200);
    expect((await get(`/api/actions/${created.requestId}`)).body.approval.snapshot).toEqual(body);
    await post(`/api/actions/${created.requestId}/execute`, body, managerAuth).expect(200);
  });

  it.each(['target', 'subject', 'body', 'agentId', 'action'])('denies changed %s after approval without consuming authorization', async field => {
    const body = email('customer@example.com');
    const id = (await post('/api/actions', body)).body.requestId;
    await post(`/api/actions/${id}/review`, { decision: 'APPROVE' }, managerAuth).expect(200);
    const tampered = structuredClone(body);
    if (field === 'subject' || field === 'body') tampered.arguments[field] += ' changed';
    else if (field === 'action') { tampered.action = 'REFUND'; tampered.arguments = { amount: 1, currency: 'INR' }; }
    else tampered[field] = field === 'target' ? 'other@example.com' : 'Wrong-Agent';
    const spy = vi.spyOn(simulator, 'simulateEmail');
    expect((await post(`/api/actions/${id}/execute`, tampered).expect(409)).body.error).toBe('EXECUTION_MISMATCH');
    expect(spy).not.toHaveBeenCalled();
    await post(`/api/actions/${id}/execute`, body).expect(200);
  });

  it.each(['blocked', 'rejected'])('never calls the email simulator for a %s action', async state => {
    const body = email(state === 'blocked' ? 'x@blocked.example' : 'customer@example.com');
    const id = (await post('/api/actions', body)).body.requestId;
    if (state === 'rejected') await post(`/api/actions/${id}/review`, { decision: 'REJECT' }, managerAuth).expect(200);
    const spy = vi.spyOn(simulator, 'simulateEmail');
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rechecks SEND_EMAIL permission after approval and prevents competing or repeated execution', async () => {
    const body = email('customer@example.com');
    const id = (await post('/api/actions', body)).body.requestId;
    await post(`/api/actions/${id}/review`, { decision: 'APPROVE' }, managerAuth).expect(200);
    await configureAgent({ agentId: body.agentId, status: 'active', allowedTools: ['REFUND'] });
    expect((await post(`/api/actions/${id}/execute`, body).expect(403)).body.error).toBe('TOOL_NOT_ALLOWED');
    await configureAgent({ agentId: body.agentId, status: 'active', allowedTools: ['REFUND', 'SEND_EMAIL'] });
    const results = await Promise.all([post(`/api/actions/${id}/execute`, body), post(`/api/actions/${id}/execute`, body)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await post(`/api/actions/${id}/execute`, body).expect(409)).body.error).toBe('REPLAY_DETECTED');
    expect(await prisma.executionRecord.count()).toBe(1);
  });

  it('does not grant email permission from REFUND or expose another owner’s records', async () => {
    await configureAgent({ agentId: 'Email-Agent', status: 'active', allowedTools: ['REFUND'] });
    expect((await post('/api/actions', email()).expect(403)).body.error).toBe('TOOL_NOT_ALLOWED');
    expect(await prisma.actionRequest.count()).toBe(0);
    await configureAgent({ agentId: 'Email-Agent', status: 'active', allowedTools: ['SEND_EMAIL'] });
    await post('/api/actions', email(), outsiderAuth).expect(403);
    const id = (await post('/api/actions', email())).body.requestId;
    await get(`/api/actions/${id}`, outsiderAuth).expect(404);
    await get(`/api/actions/${id}/audit`, outsiderAuth).expect(404);
    await post(`/api/actions/${id}/execute`, email(), outsiderAuth).expect(404);
  });

  it('requires authentication and CSRF on email submissions', async () => {
    await request(app).post('/api/actions').send(email()).expect(401);
    await request(app).post('/api/actions').set('Cookie', `agentshield_session=${ownerAuth.token}`).send(email()).expect(403);
  });

  it.each([
    { target: 'one@example.com,two@example.com' }, { target: 'not-an-email' },
    { arguments: { subject: 'Bad\r\nBcc: attacker@example.com', body: 'Hello' } },
    { arguments: { subject: '', body: 'Hello' } }, { arguments: { subject: 'Hello', body: ' ' } },
    { arguments: { subject: 'Hello', body: 'x'.repeat(8001) } },
    { arguments: { subject: 'Hello', body: 'Hello', attachments: ['file'] } },
    { cc: 'other@example.com' },
  ])('rejects unsupported or malformed email fields %#', async invalid => {
    await post('/api/actions', { ...email(), ...invalid }).expect(400);
    expect(await prisma.actionRequest.count()).toBe(0);
  });

  it('returns 413 for oversized JSON without saving a request', async () => {
    await post('/api/actions', { ...email(), arguments: { subject: 'Large', body: 'x'.repeat(20000) } }).expect(413);
    expect(await prisma.actionRequest.count()).toBe(0);
  });

  it('fails closed on OPA errors and rolls back a failed simulation for safe retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(policy, 'evaluateEmailPolicy').mockImplementationOnce(() => { throw new PolicyUnavailableError('Engine failure'); });
    await post('/api/actions', email()).expect(503);
    expect(await prisma.actionRequest.count()).toBe(0);
    const id = (await post('/api/actions', email())).body.requestId;
    vi.spyOn(simulator, 'simulateEmail').mockImplementationOnce(() => { throw new Error('Simulation failure'); });
    await post(`/api/actions/${id}/execute`, email()).expect(500);
    expect(await prisma.executionRecord.count()).toBe(0);
    expect((await get(`/api/actions/${id}`)).body.status).toBe('AUTHORIZED');
    await post(`/api/actions/${id}/execute`, email()).expect(200);
  });

  it('reads legacy refund decisions that predate generic policy snapshots', async () => {
    const saved = await prisma.actionRequest.create({ data: { ownerId: owner.id, agentId: 'Email-Agent', action: 'REFUND', target: 'Customer-123', arguments: { amount: 1, currency: 'INR' }, status: 'AUTHORIZED',
      policyDecision: { create: { decision: 'ALLOW', reason: 'Legacy', policyVersion: 'refund-v1', autoApproveLimit: 5000, maxAllowedRefund: 20000 } } } });
    expect((await get(`/api/actions/${saved.id}`).expect(200)).body.policyDecision.policy).toEqual({ autoApproveLimit: 5000, maxAllowedRefund: 20000 });
  });
});
