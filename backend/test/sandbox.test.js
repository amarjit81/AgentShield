import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { startSession } from '../src/services/authService.js';
import { configureAgent, registerAgent } from '../src/services/agentService.js';
import * as policy from '../src/services/sandboxPolicyService.js';
import { PolicyUnavailableError } from '../src/services/opaPolicy.js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as fileTool from '../src/services/sandboxFileTool.js';

if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Use an isolated disposable database with AGENTSHIELD_TEST_DATABASE=1.');
let owner, manager, outsider, ownerAuth, managerAuth, outsiderAuth;
let currentTarget;
const file = (operation = 'WRITE', target = currentTarget) => ({ agentId: 'Sandbox-Agent', action: 'SANDBOX_FILE', target,
  arguments: { operation, ...(['WRITE', 'CHANGE'].includes(operation) ? { content: '  Demo\n<script>text</script>  ' } : {}) } });
const post = (path, body, auth = ownerAuth) => request(app).post(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken).send(body);
const get = (path, auth = ownerAuth) => request(app).get(path).set('Cookie', `agentshield_session=${auth.token}`);
async function approveFile(id) {
  const preview = (await get(`/api/actions/${id}/file-preview`, managerAuth).expect(200)).body;
  await post(`/api/actions/${id}/review`, { decision: 'APPROVE', fileSha256: preview.fileSha256 }, managerAuth).expect(200);
  return preview;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  currentTarget = `workspace/test-${randomUUID()}.txt`;
  await prisma.refundPolicy.deleteMany();
  await prisma.actionRequest.deleteMany(); await prisma.authSession.deleteMany(); await prisma.agent.deleteMany(); await prisma.user.deleteMany();
  owner = await prisma.user.create({ data: { email: 'sandbox-owner@example.test', role: 'USER', passwordHash: 'unused' } });
  manager = await prisma.user.create({ data: { email: 'sandbox-manager@example.test', role: 'MANAGER', passwordHash: 'unused' } });
  outsider = await prisma.user.create({ data: { email: 'sandbox-outsider@example.test', role: 'USER', passwordHash: 'unused' } });
  await registerAgent({ agentId: 'Sandbox-Agent', name: 'Sandbox Agent', ownerEmail: owner.email, allowedTools: ['SANDBOX_FILE'] });
  ownerAuth = await startSession(owner); managerAuth = await startSession(manager); outsiderAuth = await startSession(outsider);
});
afterAll(async () => { await prisma.actionRequest.deleteMany(); await prisma.$disconnect(); });

describe('Sandbox API flow', () => {
  it.each(['READ', 'WRITE'])('persists %s policy, receipt, and audit', async operation => {
    const body = file(operation);
    if (operation === 'READ') await fileTool.executeSandboxFile(file('WRITE'));
    const created = await post('/api/actions', body).expect(201);
    expect(created.body).toMatchObject({ action: 'SANDBOX_FILE', decision: 'ALLOW', status: 'AUTHORIZED', executionMode: 'SIMULATED' });
    const id = created.body.requestId;
    const executed = await post(`/api/actions/${id}/execute`, body).expect(200);
    expect(executed.body.execution.result).toMatchObject({ tool: 'SANDBOX_FILE', simulated: false, filesystemAccessed: true, target: body.target, operation });
    if (operation === 'READ') expect(executed.body.execution.result.content).toBe('  Demo\n<script>text</script>  ');
    expect((await get(`/api/actions/${id}`)).body.policyDecision.policy.allowedRoot).toBe('workspace/');
    expect((await get(`/api/actions/${id}/audit`)).body.events.map(event => event.event)).toEqual(['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'SANDBOX_FILE_RESERVED', 'SANDBOX_FILE_EXECUTED']);
  });

  it('queues deletes, requires manager approval, and saves the exact snapshot', async () => {
    const body = file('DELETE');
    await fileTool.executeSandboxFile(file('WRITE'));
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    const spy = vi.spyOn(fileTool, 'executeSandboxFile');
    await post(`/api/actions/${id}/execute`, body).expect(409);
    expect(spy).not.toHaveBeenCalled();
    expect((await get('/api/actions/pending', managerAuth)).body.requests[0]).toMatchObject(body);
    await post(`/api/actions/${id}/review`, { decision: 'APPROVE' }).expect(403);
    const preview = await approveFile(id);
    expect(preview.content).toBe(file('WRITE').arguments.content);
    expect((await get(`/api/actions/${id}`)).body.approval.snapshot).toEqual({ ...body, fileSha256: preview.fileSha256 });
    expect((await post(`/api/actions/${id}/execute`, { ...body, target: 'workspace/other.txt' }).expect(409)).body.error).toBe('EXECUTION_MISMATCH');
    expect((await post(`/api/actions/${id}/execute`, { ...body, arguments: { operation: 'READ' } }).expect(409)).body.error).toBe('EXECUTION_MISMATCH');
    expect(spy).not.toHaveBeenCalled();
    await post(`/api/actions/${id}/execute`, body, managerAuth).expect(200);
  });

  it('shows the Manager the current text and the proposed change before approving', async () => {
    await fileTool.executeSandboxFile(file('WRITE'));
    const body = file('CHANGE');
    body.arguments.content = 'Approved replacement';
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    await get(`/api/actions/${id}/file-preview`, ownerAuth).expect(403);
    const preview = (await get(`/api/actions/${id}/file-preview`, managerAuth).expect(200)).body;
    expect(preview.content).toBe(file('WRITE').arguments.content);
    expect((await get(`/api/actions/${id}`, managerAuth)).body.arguments.content).toBe('Approved replacement');
    await post(`/api/actions/${id}/review`, { decision: 'APPROVE' }, managerAuth).expect(409);
    await post(`/api/actions/${id}/review`, { decision: 'APPROVE', fileSha256: preview.fileSha256 }, managerAuth).expect(200);
    await post(`/api/actions/${id}/execute`, body).expect(200);
    expect((await fileTool.readSandboxFile(body.target)).content).toBe('Approved replacement');
  });

  it('rejects approval after the previewed file changes', async () => {
    await fileTool.executeSandboxFile(file('WRITE'));
    const body = file('DELETE');
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    const preview = (await get(`/api/actions/${id}/file-preview`, managerAuth).expect(200)).body;
    await writeFile(join(fileTool.sandboxDirectory, currentTarget.slice('workspace/'.length)), 'changed externally');
    expect((await post(`/api/actions/${id}/review`, { decision: 'APPROVE', fileSha256: preview.fileSha256 }, managerAuth).expect(409)).body.error).toBe('FILE_PREVIEW_CHANGED');
    expect((await get(`/api/actions/${id}`)).body.status).toBe('PENDING_APPROVAL');
  });

  it('refuses to change a file that changed after Manager approval', async () => {
    await fileTool.executeSandboxFile(file('WRITE'));
    const body = file('CHANGE');
    body.arguments.content = 'Replacement';
    const id = (await post('/api/actions', body).expect(201)).body.requestId;
    await approveFile(id);
    await writeFile(join(fileTool.sandboxDirectory, currentTarget.slice('workspace/'.length)), 'changed after approval');
    await post(`/api/actions/${id}/execute`, body).expect(500);
    expect((await fileTool.readSandboxFile(body.target)).content).toBe('changed after approval');
    expect((await get(`/api/actions/${id}`)).body.status).toBe('FAILED');
  });

  it.each(['blocked', 'rejected'])('does not simulate a %s request', async state => {
    const body = file('DELETE', state === 'blocked' ? 'workspace/protected/config.txt' : undefined);
    const created = (await post('/api/actions', body).expect(201)).body;
    if (state === 'blocked') expect(created.decision).toBe('BLOCK');
    else await post(`/api/actions/${created.requestId}/review`, { decision: 'REJECT' }, managerAuth).expect(200);
    const spy = vi.spyOn(fileTool, 'executeSandboxFile');
    await post(`/api/actions/${created.requestId}/execute`, body).expect(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['target', 'operation', 'content', 'agentId', 'action'])('rejects changed %s without consuming authorization', async field => {
    const body = file();
    const id = (await post('/api/actions', body)).body.requestId;
    const changed = structuredClone(body);
    if (field === 'target') changed.target = 'workspace/other.txt';
    if (field === 'operation') changed.arguments = { operation: 'DELETE' };
    if (field === 'content') changed.arguments.content += ' ';
    if (field === 'agentId') changed.agentId = 'Other-Agent';
    if (field === 'action') { changed.action = 'REFUND'; changed.arguments = { amount: 1, currency: 'INR' }; }
    expect((await post(`/api/actions/${id}/execute`, changed).expect(409)).body.error).toBe('EXECUTION_MISMATCH');
    await post(`/api/actions/${id}/execute`, body).expect(200);
  });

  it('rechecks permission after approval and prevents concurrent execution and replay', async () => {
    const body = file('DELETE');
    await fileTool.executeSandboxFile(file('WRITE'));
    const id = (await post('/api/actions', body)).body.requestId;
    await approveFile(id);
    await configureAgent({ agentId: body.agentId, status: 'active', allowedTools: ['REFUND', 'SEND_EMAIL'] });
    expect((await post(`/api/actions/${id}/execute`, body).expect(403)).body.error).toBe('TOOL_NOT_ALLOWED');
    await configureAgent({ agentId: body.agentId, status: 'active', allowedTools: ['SANDBOX_FILE'] });
    const outcomes = await Promise.all([post(`/api/actions/${id}/execute`, body), post(`/api/actions/${id}/execute`, body)]);
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual([200, 409]);
    expect((await post(`/api/actions/${id}/execute`, body).expect(409)).body.error).toBe('REPLAY_DETECTED');
    expect(await prisma.executionRecord.count()).toBe(1);
  });

  it('requires authentication, CSRF, ownership, and explicit scope', async () => {
    await request(app).post('/api/actions').send(file()).expect(401);
    await request(app).post('/api/actions').set('Cookie', `agentshield_session=${ownerAuth.token}`).send(file()).expect(403);
    await post('/api/actions', file(), outsiderAuth).expect(403);
    const id = (await post('/api/actions', file())).body.requestId;
    await get(`/api/actions/${id}`, outsiderAuth).expect(404);
    await get(`/api/actions/${id}/audit`, outsiderAuth).expect(404);
    await post(`/api/actions/${id}/execute`, file(), outsiderAuth).expect(404);
    await configureAgent({ agentId: 'Sandbox-Agent', status: 'active', allowedTools: ['REFUND'] });
    expect((await post('/api/actions', file()).expect(403)).body.error).toBe('TOOL_NOT_ALLOWED');
  });

  it('rejects invalid paths before saving and returns 503 without partial data on policy failure', async () => {
    await post('/api/actions', file('READ', 'workspace/../secret')).expect(400);
    vi.spyOn(policy, 'evaluateSandboxPolicy').mockImplementation(() => { throw new PolicyUnavailableError('Unavailable'); });
    await post('/api/actions', file()).expect(503);
    expect(await prisma.actionRequest.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it('saves a failed real file attempt and refuses replay', async () => {
    const body = file();
    const id = (await post('/api/actions', body)).body.requestId;
    vi.spyOn(fileTool, 'executeSandboxFile').mockImplementationOnce(() => { throw new Error('File failure'); });
    await post(`/api/actions/${id}/execute`, body).expect(500);
    expect(await prisma.executionRecord.count()).toBe(1);
    expect((await get(`/api/actions/${id}`)).body.status).toBe('FAILED');
    expect((await get(`/api/actions/${id}/audit`)).body.events.at(-1).event).toBe('SANDBOX_FILE_FAILED');
    await post(`/api/actions/${id}/execute`, body).expect(409);
  });
});
