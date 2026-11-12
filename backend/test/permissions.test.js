import rawRequest from 'supertest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';
import { startSession } from '../src/services/authService.js';
import { configureAgent, registerAgent } from '../src/services/agentService.js';
import { setupDemo } from '../src/services/demoService.js';
import * as simulator from '../src/services/refundSimulator.js';
import * as policy from '../src/services/policyService.js';

if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Use AGENTSHIELD_TEST_DATABASE=1 only with an isolated disposable database.');
let owner, manager, ownerClient, managerClient;
const body = amount => ({ agentId: 'Scoped-Agent', action: 'REFUND', target: 'Customer-123', arguments: { amount, currency: 'INR' } });
const demoPasswords = { userPassword: 'Test-user-password-123!', managerPassword: 'Test-manager-password-123!' };
async function client(user) {
  const auth = await startSession(user);
  return { get: path => rawRequest(app).get(path).set('Cookie', `agentshield_session=${auth.token}`),
    put: path => rawRequest(app).put(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken),
    post: path => rawRequest(app).post(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken) };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
  await prisma.refundPolicy.deleteMany(); await prisma.emailPolicy.deleteMany(); await prisma.sandboxPolicy.deleteMany();
  await prisma.actionRequest.deleteMany(); await prisma.agent.deleteMany(); await prisma.authSession.deleteMany(); await prisma.user.deleteMany();
  owner = await prisma.user.create({ data: { email: 'owner@example.test', role: 'USER', passwordHash: 'unused-test-hash' } });
  manager = await prisma.user.create({ data: { email: 'manager@example.test', role: 'MANAGER', passwordHash: 'unused-test-hash' } });
  await prisma.agent.create({ data: { id: 'Scoped-Agent', name: 'Scoped Agent', ownerId: owner.id, allowedTools: ['REFUND'] } });
  ownerClient = await client(owner); managerClient = await client(manager);
});
afterAll(async () => { await prisma.refundPolicy.deleteMany(); await prisma.emailPolicy.deleteMany(); await prisma.sandboxPolicy.deleteMany(); await prisma.$disconnect(); });

async function command(script, args = [], input = '') {
  await prisma.$disconnect();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`scripts/${script}.js`, ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}

describe('Refund policy customization', () => {
  const settings = { autoApproveLimit: 10000, maxAllowedRefund: 25000, version: 1 };
  it('requires manager access and CSRF for saving policy', async () => {
    await rawRequest(app).get('/api/policy').expect(401);
    await ownerClient.get('/api/policy').expect(403);
    await ownerClient.put('/api/policy').send(settings).expect(403);
    const session = await startSession(manager);
    await rawRequest(app).put('/api/policy').set('Cookie', `agentshield_session=${session.token}`).send(settings).expect(403);
  });
  it.each(['MANAGER', 'ADMIN'])('allows %s changes for new requests while preserving saved policy snapshots', async role => {
    await prisma.user.update({ where: { id: manager.id }, data: { role } });
    expect((await managerClient.get('/api/policy').expect(200)).body.policy).toMatchObject({ autoApproveLimit: 5000, maxAllowedRefund: 20000, version: 1 });
    const original = (await ownerClient.post('/api/actions').send(body(8000)).expect(201)).body;
    const saved = (await managerClient.put('/api/policy').send(settings).expect(200)).body.policy;
    expect(saved).toMatchObject({ autoApproveLimit: 10000, maxAllowedRefund: 25000, version: 2, updatedByEmail: manager.email });
    expect((await ownerClient.post('/api/actions').send(body(8000)).expect(201)).body.decision).toBe('ALLOW');
    expect((await ownerClient.post('/api/actions').send(body(25000)).expect(201)).body.decision).toBe('REQUIRE_APPROVAL');
    expect((await ownerClient.post('/api/actions').send(body(25001)).expect(201)).body.decision).toBe('BLOCK');
    const previous = (await managerClient.get(`/api/actions/${original.requestId}`).expect(200)).body;
    expect(previous.status).toBe('PENDING_APPROVAL');
    expect(previous.policyDecision).toMatchObject({ policyVersion: 'opa-refund-r1-v1', policy: { autoApproveLimit: 5000, maxAllowedRefund: 20000 } });
    await managerClient.put('/api/policy').send(settings).expect(409);
    expect((await managerClient.get('/api/policy').expect(200)).body.policy.version).toBe(2);
  });
  it.each([
    { autoApproveLimit: -1 }, { maxAllowedRefund: 0 }, { autoApproveLimit: 30000 },
    { autoApproveLimit: 12.5 }, { maxAllowedRefund: 1000000001 }, { extra: true },
  ])('rejects invalid policy edits %j', async invalid => {
    await managerClient.put('/api/policy').send({ ...settings, ...invalid }).expect(400);
    expect(await prisma.refundPolicy.count()).toBe(0);
  });
});

describe('Email and sandbox policy customization', () => {
  it('saves versioned email settings and rejects stale or invalid edits', async () => {
    const initial = (await managerClient.get('/api/policy/email').expect(200)).body.policy;
    expect(initial).toMatchObject({ version: 1, externalAction: 'REQUIRE_APPROVAL' });
    const settings = { version: initial.version, internalDomains: ['company.test'], blockedDomains: ['blocked.test'], externalAction: 'BLOCK' };
    const saved = (await managerClient.put('/api/policy/email').send(settings).expect(200)).body.policy;
    expect(saved).toMatchObject({ ...settings, version: 2, updatedByEmail: manager.email });
    await managerClient.put('/api/policy/email').send(settings).expect(409);
    await managerClient.put('/api/policy/email').send({ ...saved, internalDomains: ['*.invalid.test'] }).expect(400);
    await ownerClient.get('/api/policy/email').expect(403);
  });

  it('saves versioned sandbox settings and preserves the permanent input limits', async () => {
    const initial = (await managerClient.get('/api/policy/sandbox').expect(200)).body.policy;
    expect(initial).toMatchObject({ version: 2, allowedPaths: ['workspace/'], maxContentBytes: 8000 });
    const settings = { version: initial.version, allowedPaths: ['workspace/reports/'], protectedPaths: ['workspace/reports/private/'],
      operationActions: { READ: 'ALLOW', WRITE: 'REQUIRE_APPROVAL', CHANGE: 'BLOCK', DELETE: 'BLOCK' }, maxContentBytes: 4000 };
    const saved = (await managerClient.put('/api/policy/sandbox').send(settings).expect(200)).body.policy;
    expect(saved).toMatchObject({ ...settings, version: 3, updatedByEmail: manager.email });
    await managerClient.put('/api/policy/sandbox').send(settings).expect(409);
    await managerClient.put('/api/policy/sandbox').send({ ...settings, version: 3, allowedPaths: ['outside/'] }).expect(400);
    await ownerClient.get('/api/policy/sandbox').expect(403);
  });
});

describe('Pending request queue', () => {
  it('requires login and denies ordinary users access to the manager queue', async () => {
    await rawRequest(app).get('/api/actions/pending').expect(401);
    expect((await ownerClient.get('/api/actions/pending').expect(403)).body.error).toBe('ROLE_FORBIDDEN');
  });

  it.each(['MANAGER', 'ADMIN'])('lets a %s discover submitted requests and removes reviewed requests', async role => {
    await prisma.user.update({ where: { id: manager.id }, data: { role } });
    expect((await managerClient.get('/api/actions/pending').expect(200)).body).toEqual({ requests: [], hasMore: false });
    await ownerClient.post('/api/actions').send(body(2000)).expect(201);
    await ownerClient.post('/api/actions').send(body(30000)).expect(201);
    const first = (await ownerClient.post('/api/actions').send(body(8000)).expect(201)).body.requestId;
    const second = (await ownerClient.post('/api/actions').send(body(9000)).expect(201)).body.requestId;
    const queue = await managerClient.get('/api/actions/pending').expect(200);
    expect(queue.headers['cache-control']).toBe('no-store');
    expect(queue.body.requests.map(request => request.requestId)).toEqual([first, second]);
    expect(queue.body.requests[0]).toMatchObject({ agentId: 'Scoped-Agent', status: 'PENDING_APPROVAL', owner: { email: owner.email }, arguments: { amount: 8000, currency: 'INR' } });
    expect(Object.keys(queue.body.requests[0].owner)).toEqual(['email']);
    await managerClient.post(`/api/actions/${first}/review`).send({ decision: 'APPROVE' }).expect(200);
    await managerClient.post(`/api/actions/${second}/review`).send({ decision: 'REJECT' }).expect(200);
    expect((await managerClient.get('/api/actions/pending').expect(200)).body).toEqual({ requests: [], hasMore: false });
  });

  it('bounds the queue to the oldest 100 requests and indicates more waiting', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    await prisma.actionRequest.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
      agentId: 'Scoped-Agent', ownerId: owner.id, action: 'REFUND', target: `Customer-${index}`,
      arguments: { amount: 8000, currency: 'INR' }, status: 'PENDING_APPROVAL', createdAt: new Date(createdAt.getTime() + index * 1000),
    })) });
    const queue = (await managerClient.get('/api/actions/pending').expect(200)).body;
    expect(queue.requests).toHaveLength(100);
    expect(queue.hasMore).toBe(true);
    expect(queue.requests[0].target).toBe('Customer-0');
    expect(queue.requests.at(-1).target).toBe('Customer-99');
  });
});

describe('Agent permission enforcement and listing', () => {
  it('denies submission without REFUND permission before policy or persistence', async () => {
    await configureAgent({ agentId: 'Scoped-Agent', status: 'active', allowedTools: [] });
    const spy = vi.spyOn(policy, 'evaluateRefundPolicy');
    expect((await ownerClient.post('/api/actions').send(body(2000)).expect(403)).body.error).toBe('TOOL_NOT_ALLOWED');
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.actionRequest.count()).toBe(0); expect(await prisma.policyDecision.count()).toBe(0); expect(await prisma.auditEvent.count()).toBe(0);
  });

  it.each(['USER', 'MANAGER', 'ADMIN'])('lists only owned agents for a %s, including inactive and unpermitted entries', async role => {
    await prisma.user.update({ where: { id: owner.id }, data: { role } });
    await prisma.agent.create({ data: { id: 'Disabled', name: 'Disabled', ownerId: owner.id, active: false } });
    await prisma.agent.create({ data: { id: 'Foreign', name: 'Foreign', ownerId: manager.id, allowedTools: ['REFUND'] } });
    const response = await ownerClient.get(`/api/agents?ownerId=${manager.id}`).expect(200);
    expect(response.body.agents.map(agent => agent.id)).toEqual(['Disabled', 'Scoped-Agent']);
    expect(response.body.agents[0]).toMatchObject({ active: false, allowedTools: [] });
    expect(response.body.agents[1].allowedTools).toEqual(['REFUND']);
    expect(response.body.agents.every(agent => !agent.owner && !agent.ownerId && !agent.passwordHash)).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('requires login for listing and returns an empty list when there are no owned agents', async () => {
    await rawRequest(app).get('/api/agents').expect(401);
    expect((await managerClient.get('/api/agents').expect(200)).body).toEqual({ agents: [] });
  });

  it.each([2000, 8000])('rechecks registry changes before executing an authorized %i refund', async amount => {
    const created = await ownerClient.post('/api/actions').send(body(amount)).expect(201);
    const id = created.body.requestId;
    if (amount === 8000) await managerClient.post(`/api/actions/${id}/review`).send({ decision: 'APPROVE' }).expect(200);
    const spy = vi.spyOn(simulator, 'simulateRefund');
    const changes = [
      [{ active: false }, 'AGENT_INACTIVE'],
      [{ active: true, allowedTools: [] }, 'TOOL_NOT_ALLOWED'],
      [{ allowedTools: ['REFUND'], ownerId: manager.id }, 'AGENT_NOT_OWNED'],
    ];
    for (const [data, error] of changes) {
      await prisma.agent.update({ where: { id: 'Scoped-Agent' }, data });
      const response = await managerClient.post(`/api/actions/${id}/execute`).send(body(amount)).expect(403);
      expect(response.body.error).toBe(error);
      expect(response.body.status).toBe(amount === 8000 ? 'APPROVED' : 'AUTHORIZED');
    }
    await prisma.agent.delete({ where: { id: 'Scoped-Agent' } });
    expect((await ownerClient.post(`/api/actions/${id}/execute`).send(body(amount)).expect(403)).body.error).toBe('AGENT_NOT_REGISTERED');
    expect(spy).not.toHaveBeenCalled(); expect(await prisma.executionRecord.count()).toBe(0);
    const denials = await prisma.auditEvent.findMany({ where: { requestId: id, event: 'EXECUTION_DENIED' }, orderBy: { id: 'asc' } });
    expect(denials.map(event => event.details.code)).toEqual(['AGENT_INACTIVE', 'TOOL_NOT_ALLOWED', 'AGENT_NOT_OWNED', 'AGENT_NOT_REGISTERED']);
  });

  it('allows a manager to execute for the request owner after restored permission and still rejects replay', async () => {
    const id = (await ownerClient.post('/api/actions').send(body(8000)).expect(201)).body.requestId;
    await managerClient.post(`/api/actions/${id}/review`).send({ decision: 'APPROVE' }).expect(200);
    await configureAgent({ agentId: 'Scoped-Agent', status: 'active', allowedTools: [] });
    await managerClient.post(`/api/actions/${id}/execute`).send(body(8000)).expect(403);
    await configureAgent({ agentId: 'Scoped-Agent', status: 'active', allowedTools: ['REFUND'] });
    await managerClient.post(`/api/actions/${id}/execute`).send(body(8000)).expect(200);
    await configureAgent({ agentId: 'Scoped-Agent', status: 'inactive', allowedTools: [] });
    expect((await ownerClient.post(`/api/actions/${id}/execute`).send(body(8000)).expect(409)).body.error).toBe('REPLAY_DETECTED');
    expect(await prisma.executionRecord.count()).toBe(1);
  });

  it('denies historical authorizations with no request owner', async () => {
    const id = (await ownerClient.post('/api/actions').send(body(2000)).expect(201)).body.requestId;
    await prisma.actionRequest.update({ where: { id }, data: { ownerId: null } });
    expect((await managerClient.post(`/api/actions/${id}/execute`).send(body(2000)).expect(403)).body.error).toBe('AGENT_NOT_OWNED');
    expect(await prisma.executionRecord.count()).toBe(0);
  });

  it('registers with no implicit grant and accepts an explicit REFUND grant', async () => {
    const first = await registerAgent({ agentId: 'NoGrant', name: 'No Grant', ownerEmail: owner.email });
    expect(first.allowedTools).toEqual([]);
    const granted = await registerAgent({ agentId: 'Granted', name: 'Granted', ownerEmail: owner.email, allowedTools: ['REFUND'] });
    expect(granted.allowedTools).toEqual(['REFUND']);
  });

  it.each([[['EMAIL']], [['REFUND', 'REFUND']]])('rejects invalid tool grants %j without changing an agent', async allowedTools => {
    expect(() => configureAgent({ agentId: 'Scoped-Agent', status: 'active', allowedTools })).toThrowError();
    expect((await prisma.agent.findUnique({ where: { id: 'Scoped-Agent' } })).allowedTools).toEqual(['REFUND']);
  });

  it('configures through the local command, preserves ownership, and reports bad IDs/input', async () => {
    const result = await command('configure-agent', ['Scoped-Agent', 'inactive', 'none']);
    expect(result.code, result.stderr).toBe(0);
    expect(await prisma.agent.findUnique({ where: { id: 'Scoped-Agent' } })).toMatchObject({ ownerId: owner.id, active: false, allowedTools: [] });
    expect((await command('configure-agent', ['Scoped-Agent', 'active', 'REFUND'])).code).toBe(0);
    expect((await command('configure-agent', ['Missing', 'active', 'REFUND'])).stderr).toContain('No agent');
    expect((await command('configure-agent', ['Scoped-Agent', 'active', 'EMAIL'])).code).toBe(1);
    const registered = await command('register-agent', ['ViaCLI', 'Via CLI', owner.email, 'active', 'REFUND']);
    expect(registered.code, registered.stderr).toBe(0);
    expect((await prisma.agent.findUnique({ where: { id: 'ViaCLI' } })).allowedTools).toEqual(['REFUND']);
  });
});

describe('Repeatable presentation setup', () => {
  it('creates scenarios and restores their permissions without deleting saved requests or changing account hashes', async () => {
    const first = await setupDemo(demoPasswords);
    expect(first.accounts.map(account => account.role)).toEqual(['USER', 'MANAGER']);
    const user = await prisma.user.findUnique({ where: { email: 'user@agentshield.test' } });
    const saved = await prisma.actionRequest.create({ data: { agentId: 'Demo-Refund', action: 'REFUND', target: 'Preserved', arguments: { amount: 8000, currency: 'INR' }, ownerId: user.id, status: 'PENDING_APPROVAL' } });
    await configureAgent({ agentId: 'Demo-Revocable', status: 'inactive', allowedTools: [] });
    await setupDemo(demoPasswords);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    expect(await prisma.actionRequest.findUnique({ where: { id: saved.id } })).toEqual(saved);
    expect(await prisma.agent.findUnique({ where: { id: 'Demo-Revocable' } })).toMatchObject({ active: true, allowedTools: ['REFUND'] });
    expect((await prisma.agent.findUnique({ where: { id: 'Demo-NoRefund' } })).allowedTools).toEqual([]);
    expect((await prisma.agent.findUnique({ where: { id: 'Demo-Disabled' } })).active).toBe(false);
  }, 15000);

  it('refuses conflicting accounts and rolls back all setup writes', async () => {
    await prisma.user.create({ data: { email: 'manager@agentshield.test', role: 'USER', passwordHash: 'unused-test-hash' } });
    await expect(setupDemo(demoPasswords)).rejects.toMatchObject({ code: 'DEMO_CONFLICT' });
    expect(await prisma.user.findUnique({ where: { email: 'user@agentshield.test' } })).toBeNull();
    expect(await prisma.agent.count()).toBe(1);
  });

  it('refuses conflicting agent ownership and rolls back new accounts', async () => {
    await prisma.agent.create({ data: { id: 'Demo-Refund', name: 'Existing', ownerId: owner.id } });
    await expect(setupDemo(demoPasswords)).rejects.toMatchObject({ code: 'DEMO_CONFLICT' });
    expect(await prisma.user.findUnique({ where: { email: 'user@agentshield.test' } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'manager@agentshield.test' } })).toBeNull();
    expect((await prisma.agent.findUnique({ where: { id: 'Demo-Refund' } })).ownerId).toBe(owner.id);
  });

  it('runs setup on stdin without printing passwords and rejects malformed input', async () => {
    const result = await command('setup-demo', [], JSON.stringify(demoPasswords));
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Presentation accounts and agents are ready');
    expect(result.stdout).not.toContain(demoPasswords.userPassword); expect(result.stdout).not.toContain(demoPasswords.managerPassword);
    const invalid = await command('setup-demo', [], '{}');
    expect(invalid.code).toBe(1); expect(invalid.stderr).toContain('stdin');
  });
});
