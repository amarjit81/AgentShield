import rawRequest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as simulator from '../src/services/refundSimulator.js';
import * as policyService from '../src/services/policyService.js';
import { PolicyUnavailableError } from '../src/services/opaPolicy.js';
import * as actionRepository from '../src/repositories/actionRepository.js';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { startSession } from '../src/services/authService.js';

if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Set AGENTSHIELD_TEST_DATABASE=1 only with an isolated disposable test database.');
const password = 'Test-password-123!';
let passwordHash;
let manager;
let auth;
beforeAll(async () => { passwordHash = await bcrypt.hash(password, 12); });
function request(application) {
  const client = rawRequest(application);
  return {
    get: path => client.get(path).set('Cookie', `agentshield_session=${auth.token}`),
    post: path => client.post(path).set('Cookie', `agentshield_session=${auth.token}`).set('X-CSRF-Token', auth.session.csrfToken),
  };
}
async function account(email, role = 'USER') {
  return prisma.user.create({ data: { email, role, passwordHash } });
}

function createRefundRequest(amount = 8_000) {
  return {
    agentId: 'SupportAgent-01',
    action: 'REFUND',
    target: 'Customer-123',
    arguments: {
      amount,
      currency: 'INR',
    },
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.policyDecision.deleteMany();
  await prisma.actionRequest.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.user.deleteMany();
  manager = await account('manager@example.test', 'MANAGER');
  await prisma.agent.create({ data: { id: 'SupportAgent-01', name: 'Support Agent', ownerId: manager.id, allowedTools: ['REFUND'] } });
  auth = await startSession(manager);
});

describe('Backend refund execution and audits', () => {
  it('fails closed without saved records when OPA evaluation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(policyService, 'evaluateRefundPolicy').mockImplementationOnce(() => {
      throw new PolicyUnavailableError('OPA evaluation failed.');
    });
    const response = await request(app).post('/api/actions').send(createRefundRequest(2000)).expect(503);
    expect(response.body.error).toBe('POLICY_UNAVAILABLE');
    expect(await prisma.actionRequest.count()).toBe(0);
    expect(await prisma.policyDecision.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
    expect(await prisma.executionRecord.count()).toBe(0);
  });

  it('records the real policy engine and compiled fingerprint in the audit', async () => {
    const created = await request(app).post('/api/actions').send(createRefundRequest(2000)).expect(201);
    const audit = await request(app).get(`/api/actions/${created.body.requestId}/audit`).expect(200);
    expect(audit.body.events.find(event => event.event === 'POLICY_EVALUATED').details).toMatchObject({
      policyEngine: 'opa', policyVersion: 'opa-refund-r1-v1', policyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
  async function create(amount = 8_000, review) {
    const response = await request(app).post('/api/actions').send(createRefundRequest(amount)).expect(201);
    if (review) await request(app).post(`/api/actions/${response.body.requestId}/review`).send({ decision: review }).expect(200);
    return response.body.requestId;
  }

  it.each([[2_000, undefined], [8_000, 'APPROVE']])('executes an authorized Rs. %i refund and retrieves durable records', async (amount, review) => {
    const id = await create(amount, review);
    const response = await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest(amount)).expect(200);
    expect(response.body.execution.result).toMatchObject({ simulated: true, amount, currency: 'INR', agentId: 'SupportAgent-01', target: 'Customer-123' });
    const stored = await request(app).get(`/api/actions/${id}`).expect(200);
    expect(stored.body.status).toBe('EXECUTED');
    expect(stored.body.execution.id).toBe(response.body.execution.id);
    if (review) expect(stored.body.approval.snapshot).toEqual(createRefundRequest(amount));
    const audit = await request(app).get(`/api/actions/${id}/audit`).expect(200);
    expect(audit.body.events.map(event => event.event)).toEqual(review
      ? ['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'ACTION_REVIEWED', 'REFUND_EXECUTED']
      : ['REQUEST_RECEIVED', 'POLICY_EVALUATED', 'REFUND_EXECUTED']);
  });

  it.each([[8_000, undefined, 'PENDING_APPROVAL'], [8_000, 'REJECT', 'REJECTED'], [25_000, undefined, 'BLOCKED']])(
    'never calls the simulator for a %s refund in %s state', async (amount, review, status) => {
      const id = await create(amount, review);
      const spy = vi.spyOn(simulator, 'simulateRefund');
      const denied = await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest(amount)).expect(409);
      expect(denied.body.error).toBe('ACTION_NOT_AUTHORIZED');
      expect(spy).not.toHaveBeenCalled();
      expect(await prisma.executionRecord.count({ where: { requestId: id } })).toBe(0);
      expect((await prisma.actionRequest.findUnique({ where: { id } })).status).toBe(status);
      expect(await prisma.auditEvent.count({ where: { requestId: id, event: 'EXECUTION_DENIED' } })).toBe(1);
    },
  );

  it.each(['amount', 'agentId', 'target', 'currency'])('blocks changed %s without consuming authorization', async field => {
    const id = await create(8_000, 'APPROVE');
    const body = createRefundRequest();
    if (field === 'amount') body.arguments.amount = 80_000;
    else if (field === 'currency') body.arguments.currency = 'USD';
    else body[field] = 'different-value';
    const spy = vi.spyOn(simulator, 'simulateRefund');
    const denied = await request(app).post(`/api/actions/${id}/execute`).send(body).expect(409);
    expect(denied.body.error).toBe('EXECUTION_MISMATCH');
    expect(spy).not.toHaveBeenCalled();
    await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest()).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects sequential replay and competing executions with exactly one receipt', async () => {
    const id = await create(8_000, 'APPROVE');
    const spy = vi.spyOn(simulator, 'simulateRefund');
    const results = await Promise.all([1, 2].map(() => request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest())));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(results.find(result => result.status === 409).body.error).toBe('REPLAY_DETECTED');
    await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest()).expect(409);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.executionRecord.count({ where: { requestId: id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { requestId: id, event: 'REFUND_EXECUTED' } })).toBe(1);
  });

  it('rolls back a failed simulator operation and permits a safe retry', async () => {
    const id = await create(2_000);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(simulator, 'simulateRefund').mockImplementationOnce(() => { throw new Error('Simulated failure'); });
    const failed = await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest(2_000)).expect(500);
    expect(failed.body.error).toBe('INTERNAL_SERVER_ERROR');
    expect((await prisma.actionRequest.findUnique({ where: { id } })).status).toBe('AUTHORIZED');
    expect(await prisma.executionRecord.count({ where: { requestId: id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { requestId: id, event: 'EXECUTION_FAILED' } })).toBe(1);
    await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest(2_000)).expect(200);
  });

  it('validates execution input and unknown identifiers', async () => {
    const id = await create(2_000);
    await request(app).post(`/api/actions/${id}/execute`).send({ ...createRefundRequest(2_000), extra: true }).expect(400);
    await request(app).post(`/api/actions/${id}/execute`).send({ ...createRefundRequest(2_000), arguments: { amount: -1, currency: 'INR' } }).expect(400);
    await request(app).post('/api/actions/bad-id/execute').send(createRefundRequest()).expect(400);
    await request(app).post('/api/actions/00000000-0000-4000-8000-000000000000/execute').send(createRefundRequest()).expect(404);
    expect(await prisma.executionRecord.count()).toBe(0);
  });

  it('paginates audit events in stable order without duplicates', async () => {
    const id = await create(8_000, 'APPROVE');
    const first = await request(app).get(`/api/actions/${id}/audit?limit=2`).expect(200);
    const second = await request(app).get(`/api/actions/${id}/audit?after=${first.body.nextCursor}&limit=2`).expect(200);
    expect(first.body.events).toHaveLength(2);
    expect(second.body.events).toHaveLength(1);
    expect(second.body.events[0].event).toBe('ACTION_REVIEWED');
    expect(second.body.events[0].id).toBeGreaterThan(first.body.nextCursor);
    await request(app).get(`/api/actions/${id}/audit?limit=101`).expect(400);
    await request(app).get(`/api/actions/${id}/audit?after=-1`).expect(400);
    await request(app).get(`/api/actions/${id}/audit?after=wrong`).expect(400);
    await request(app).get('/api/actions/bad-id/audit').expect(400);
    await request(app).get('/api/actions/00000000-0000-4000-8000-000000000000/audit').expect(404);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/actions', () => {
  it.each([
    [2_000, 'ALLOW', 'AUTHORIZED'],
    [8_000, 'REQUIRE_APPROVAL', 'PENDING_APPROVAL'],
    [25_000, 'BLOCK', 'BLOCKED'],
  ])(
    'returns the expected policy result for a refund of Rs. %i',
    async (amount, expectedDecision, expectedStatus) => {
      const response = await request(app)
        .post('/api/actions')
        .send(createRefundRequest(amount))
        .expect(201);

      expect(response.body).toMatchObject({
        agentId: 'SupportAgent-01',
        action: 'REFUND',
        target: 'Customer-123',
        arguments: { amount, currency: 'INR' },
        decision: expectedDecision,
        status: expectedStatus,
        policy: {
          autoApproveLimit: 5_000,
          maxAllowedRefund: 20_000,
        },
      });
      expect(response.body.reason).toEqual(expect.any(String));
      expect(response.body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(Number.isNaN(Date.parse(response.body.receivedAt))).toBe(false);

      const storedRequest = await prisma.actionRequest.findUnique({
        where: { id: response.body.requestId },
        include: { policyDecision: true },
      });

      expect(storedRequest).toMatchObject({
        agentId: 'SupportAgent-01',
        action: 'REFUND',
        target: 'Customer-123',
        arguments: { amount, currency: 'INR' },
        status: expectedStatus,
        policyDecision: {
          decision: expectedDecision,
          reason: response.body.reason,
          policyVersion: 'opa-refund-r1-v1',
          autoApproveLimit: 5_000,
          maxAllowedRefund: 20_000,
        },
      });
    },
  );

  it.each([
    [5_000, 'ALLOW'],
    [5_001, 'REQUIRE_APPROVAL'],
    [20_000, 'REQUIRE_APPROVAL'],
    [20_001, 'BLOCK'],
  ])(
    'handles the Rs. %i policy boundary correctly',
    async (amount, expectedDecision) => {
      const response = await request(app)
        .post('/api/actions')
        .send(createRefundRequest(amount))
        .expect(201);

      expect(response.body.decision).toBe(expectedDecision);
    },
  );

  it.each([
    ['a negative amount', createRefundRequest(-1)],
    [
      'a missing amount',
      {
        agentId: 'SupportAgent-01',
        action: 'REFUND',
        target: 'Customer-123',
        arguments: { currency: 'INR' },
      },
    ],
  ])('rejects %s', async (_description, body) => {
    const response = await request(app)
      .post('/api/actions')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('INVALID_ACTION_REQUEST');
    expect(response.body.message).toBe('The action request is invalid.');
    expect(response.body.details).toBeDefined();
  });

  it.each([
    ['an unsupported action', { action: 'EMAIL' }],
    ['an unsupported currency', { currency: 'USD' }],
  ])('rejects %s', async (_description, change) => {
    const body = createRefundRequest();

    if (change.action) {
      body.action = change.action;
    }

    if (change.currency) {
      body.arguments.currency = change.currency;
    }

    const response = await request(app)
      .post('/api/actions')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('INVALID_ACTION_REQUEST');
  });

  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/api/actions')
      .set('Content-Type', 'application/json')
      .send('{"agentId":')
      .expect(400);

    expect(response.body).toEqual({
      error: 'INVALID_JSON',
      message: 'Request body must contain valid JSON.',
    });
  });
});

describe('POST /api/actions/:id/review', () => {
  it.each([['APPROVE', 'APPROVED'], ['REJECT', 'REJECTED']])(
    'persists a %s review without changing the policy decision',
    async (decision, status) => {
      const created = await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
      const id = created.body.requestId;
      const reviewed = await request(app).post(`/api/actions/${id}/review`).send({ decision }).expect(200);
      expect(reviewed.body).toEqual({ requestId: id, status });
      const stored = await request(app).get(`/api/actions/${id}`).expect(200);
      expect(stored.body.status).toBe(status);
      expect(stored.body.arguments.amount).toBe(8_000);
      expect(stored.body.policyDecision.decision).toBe('REQUIRE_APPROVAL');
      await request(app).post(`/api/actions/${id}/review`).send({ decision: 'APPROVE' }).expect(409);
    },
  );

  it.each([2_000, 25_000])('cannot review a non-pending refund of Rs. %i', async (amount) => {
    const created = await request(app).post('/api/actions').send(createRefundRequest(amount)).expect(201);
    const reviewed = await request(app).post(`/api/actions/${created.body.requestId}/review`).send({ decision: 'APPROVE' }).expect(409);
    expect(reviewed.body.error).toBe('ACTION_NOT_PENDING');
    const stored = await request(app).get(`/api/actions/${created.body.requestId}`).expect(200);
    expect(stored.body.status).toBe(created.body.status);
  });

  it.each([{}, { decision: 'ALLOW' }, { decision: 'APPROVE', amount: 80_000 }])(
    'rejects an invalid review body %j', async (body) => {
      const created = await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
      const reviewed = await request(app).post(`/api/actions/${created.body.requestId}/review`).send(body).expect(400);
      expect(reviewed.body.error).toBe('INVALID_ACTION_REVIEW');
      const stored = await request(app).get(`/api/actions/${created.body.requestId}`).expect(200);
      expect(stored.body.status).toBe('PENDING_APPROVAL');
    },
  );

  it('rejects a malformed ID and returns 404 for a missing request', async () => {
    await request(app).post('/api/actions/not-a-uuid/review').send({ decision: 'APPROVE' }).expect(400);
    await request(app).post('/api/actions/00000000-0000-4000-8000-000000000000/review').send({ decision: 'APPROVE' }).expect(404);
  });

  it('lets only one of two competing reviews change the pending status', async () => {
    const created = await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
    const url = `/api/actions/${created.body.requestId}/review`;
    const results = await Promise.all([
      request(app).post(url).send({ decision: 'APPROVE' }),
      request(app).post(url).send({ decision: 'REJECT' }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const stored = await request(app).get(`/api/actions/${created.body.requestId}`).expect(200);
    expect(stored.body.status).toBe(results.find(result => result.status === 200).body.status);
  });
});

describe('GET /api/actions/:id', () => {
  it('returns a persisted action and its policy decision', async () => {
    const createdResponse = await request(app)
      .post('/api/actions')
      .send(createRefundRequest())
      .expect(201);

    const response = await request(app)
      .get(`/api/actions/${createdResponse.body.requestId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      requestId: createdResponse.body.requestId,
      agentId: 'SupportAgent-01',
      action: 'REFUND',
      target: 'Customer-123',
      arguments: { amount: 8_000, currency: 'INR' },
      status: 'PENDING_APPROVAL',
      policyDecision: {
        decision: 'REQUIRE_APPROVAL',
        reason: createdResponse.body.reason,
        policyVersion: 'opa-refund-r1-v1',
        policy: {
          autoApproveLimit: 5_000,
          maxAllowedRefund: 20_000,
        },
      },
    });
    expect(Number.isNaN(Date.parse(response.body.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(response.body.updatedAt))).toBe(false);
    expect(
      Number.isNaN(Date.parse(response.body.policyDecision.decidedAt)),
    ).toBe(false);
  });

  it('rejects an action ID that is not a UUID', async () => {
    const response = await request(app)
      .get('/api/actions/not-a-uuid')
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'INVALID_ACTION_ID',
      message: 'The action ID must be a valid UUID.',
    });
    expect(response.body.details).toBeDefined();
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const response = await request(app)
      .get('/api/actions/00000000-0000-4000-8000-000000000000')
      .expect(404);

    expect(response.body).toEqual({
      error: 'ACTION_NOT_FOUND',
      message: 'No action request was found for this ID.',
    });
  });
});

describe('Registered agent checks on submission', () => {
  async function expectNoSubmission(policySpy) {
    expect(policySpy).not.toHaveBeenCalled();
    expect(await prisma.actionRequest.count()).toBe(0);
    expect(await prisma.policyDecision.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
    expect(await prisma.approvalRecord.count()).toBe(0);
    expect(await prisma.executionRecord.count()).toBe(0);
  }

  it.each(['unregistered', 'inactive'])('rejects an %s agent before policy evaluation or saving records', async state => {
    if (state === 'unregistered') await prisma.agent.deleteMany();
    else await prisma.agent.update({ where: { id: 'SupportAgent-01' }, data: { active: false } });
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    const response = await request(app).post('/api/actions').send(createRefundRequest(25000)).expect(403);
    expect(response.body.error).toBe(state === 'unregistered' ? 'AGENT_NOT_REGISTERED' : 'AGENT_INACTIVE');
    expect(response.body.requestId).toBeUndefined();
    await expectNoSubmission(policySpy);
  });

  it.each(['USER', 'MANAGER', 'ADMIN'])('does not let a %s submit for another owner', async role => {
    await prisma.user.update({ where: { id: manager.id }, data: { role } });
    const owner = await account('actual-owner@example.test');
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    for (const active of [true, false]) {
      await prisma.agent.update({ where: { id: 'SupportAgent-01' }, data: { ownerId: owner.id, active } });
      const response = await request(app).post('/api/actions').send(createRefundRequest(2000)).expect(403);
      expect(response.body.error).toBe('AGENT_NOT_OWNED');
    }
    await expectNoSubmission(policySpy);
  });

  it.each(['USER', 'ADMIN'])('allows a %s to submit for their own active agent', async role => {
    await prisma.user.update({ where: { id: manager.id }, data: { role } });
    const response = await request(app).post('/api/actions').send(createRefundRequest(8000)).expect(201);
    expect(response.body.decision).toBe('REQUIRE_APPROVAL');
    const stored = await prisma.actionRequest.findUnique({ where: { id: response.body.requestId } });
    expect(stored.ownerId).toBe(manager.id);
    expect(stored.agentId).toBe('SupportAgent-01');
  });

  it('keeps registered agent IDs case-sensitive', async () => {
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    const response = await request(app).post('/api/actions').send({ ...createRefundRequest(), agentId: 'supportagent-01' }).expect(403);
    expect(response.body.error).toBe('AGENT_NOT_REGISTERED');
    await expectNoSubmission(policySpy);
  });

  it('checks the validated trimmed agent ID and preserves the successful response contract', async () => {
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    const response = await request(app).post('/api/actions').send({ ...createRefundRequest(2000), agentId: ' SupportAgent-01 ' }).expect(201);
    expect(response.body).toMatchObject({ agentId: 'SupportAgent-01', decision: 'ALLOW', status: 'AUTHORIZED', arguments: { amount: 2000, currency: 'INR' } });
    expect(policySpy).toHaveBeenCalledExactlyOnceWith(2000, expect.objectContaining({
      autoApproveLimit: 5000, maxAllowedRefund: 20000, version: 1,
    }));
    expect(await prisma.actionRequest.count()).toBe(1);
    expect(await prisma.policyDecision.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(2);
  });

  it('uses the current agent status on each new submission', async () => {
    await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
    await prisma.agent.update({ where: { id: 'SupportAgent-01' }, data: { active: false } });
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    expect((await request(app).post('/api/actions').send(createRefundRequest()).expect(403)).body.error).toBe('AGENT_INACTIVE');
    expect(policySpy).not.toHaveBeenCalled();
    expect(await prisma.actionRequest.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(2);
  });

  it('still rejects malformed input before the registry or policy checks', async () => {
    await prisma.agent.deleteMany();
    const policySpy = vi.spyOn(policyService, 'evaluateRefundPolicy');
    const response = await request(app).post('/api/actions').send(createRefundRequest(-1)).expect(400);
    expect(response.body.error).toBe('INVALID_ACTION_REQUEST');
    await expectNoSubmission(policySpy);
  });

  it('rolls back requests, policy, and audit writes if submission fails after the nested save', async () => {
    const createRecord = actionRepository.createActionRecord;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(actionRepository, 'createActionRecord').mockImplementationOnce(async (...args) => {
      await createRecord(...args);
      throw new Error('Failure after the nested request save');
    });
    const response = await request(app).post('/api/actions').send(createRefundRequest()).expect(500);
    expect(response.body.error).toBe('INTERNAL_SERVER_ERROR');
    expect(await prisma.actionRequest.count()).toBe(0);
    expect(await prisma.policyDecision.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
    await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
  });
});

describe('Authentication and permissions', () => {
  const credentials = { email: 'manager@example.test', password };
  const login = body => rawRequest(app).post('/api/auth/login').set('X-AgentShield-Client', 'dashboard').send(body);
  const client = session => ({
    get: path => rawRequest(app).get(path).set('Cookie', `agentshield_session=${session.token}`),
    post: path => rawRequest(app).post(path).set('Cookie', `agentshield_session=${session.token}`).set('X-CSRF-Token', session.session.csrfToken),
  });

  it('logs in with a normalized email, restores the session, and never returns hashes or JWTs in JSON', async () => {
    const response = await login({ ...credentials, email: ' MANAGER@EXAMPLE.TEST ' }).expect(200);
    expect(response.body.user).toEqual({ id: manager.id, email: manager.email, role: 'MANAGER' });
    expect(response.body.csrfToken).toHaveLength(64);
    expect(response.body.token).toBeUndefined();
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=1800');
    expect(cookie).toContain('Path=/api');
    const me = await rawRequest(app).get('/api/auth/me').set('Cookie', cookie.split(';')[0]).expect(200);
    expect(me.body.csrfToken).toBe(response.body.csrfToken);
    expect(me.body.user.role).toBe('MANAGER');
  });

  it('rejects incorrect, missing, inactive, and malformed credentials without revealing accounts', async () => {
    const wrong = await login({ ...credentials, password: 'Wrong-password-123!' }).expect(401);
    const absent = await login({ ...credentials, email: 'missing@example.test' }).expect(401);
    expect(wrong.body).toEqual(absent.body);
    await prisma.user.update({ where: { id: manager.id }, data: { active: false } });
    expect((await login(credentials).expect(401)).body).toEqual(wrong.body);
    await login({ ...credentials, role: 'ADMIN' }).expect(400);
    await login({ ...credentials, password: '😀'.repeat(20) }).expect(400);
  });

  it('rejects form login and cross-origin login', async () => {
    await rawRequest(app).post('/api/auth/login').send(credentials).expect(403);
    await login(credentials).set('Origin', 'https://other.example').expect(403);
  });

  it('requires authentication on every action route before validation', async () => {
    for (const path of ['/api/actions/id', '/api/actions/id/audit']) await rawRequest(app).get(path).expect(401);
    for (const path of ['/api/actions', '/api/actions/id/review', '/api/actions/id/execute']) await rawRequest(app).post(path).send({}).expect(401);
    await rawRequest(app).get('/api/auth/me').set('Cookie', 'agentshield_session=invalid-token').expect(401);
  });

  it('requires a session-bound CSRF token for mutations, including logout', async () => {
    await rawRequest(app).post('/api/actions').set('Cookie', `agentshield_session=${auth.token}`).send(createRefundRequest()).expect(403);
    await rawRequest(app).post('/api/auth/logout').set('Cookie', `agentshield_session=${auth.token}`).expect(403);
    const other = await startSession(manager);
    await request(app).post('/api/actions').set('X-CSRF-Token', other.session.csrfToken).send(createRefundRequest()).expect(403);
    expect(await prisma.actionRequest.count()).toBe(0);
  });

  it('revokes logout server-side, including a copied JWT', async () => {
    const response = await request(app).post('/api/auth/logout').expect(204);
    expect(response.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
    await request(app).get('/api/auth/me').expect(401);
    expect(await prisma.authSession.findUnique({ where: { id: auth.session.id } })).toBeNull();
  });

  it('rejects expired database sessions, expired JWTs, forged JWTs, and deactivated users', async () => {
    await prisma.authSession.update({ where: { id: auth.session.id }, data: { expiresAt: new Date(0) } });
    await request(app).get('/api/auth/me').expect(401);
    const expired = jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: 'agentshield', audience: 'agentshield-dashboard', subject: manager.id, jwtid: auth.session.id, expiresIn: -1 });
    await rawRequest(app).get('/api/auth/me').set('Cookie', `agentshield_session=${expired}`).expect(401);
    const forged = jwt.sign({}, 'different-secret-at-least-32-bytes-long', { subject: manager.id });
    await rawRequest(app).get('/api/auth/me').set('Cookie', `agentshield_session=${forged}`).expect(401);
    auth = await startSession(manager);
    await prisma.user.update({ where: { id: manager.id }, data: { active: false } });
    await request(app).get('/api/auth/me').expect(401);
  });

  it('allows a User to create/read/execute their own request but forbids review', async () => {
    const user = await account('user@example.test');
    await prisma.agent.update({ where: { id: 'SupportAgent-01' }, data: { ownerId: user.id } });
    const userClient = client(await startSession(user));
    const created = await userClient.post('/api/actions').send(createRefundRequest(2000)).expect(201);
    const id = created.body.requestId;
    expect((await prisma.actionRequest.findUnique({ where: { id } })).ownerId).toBe(user.id);
    await userClient.get(`/api/actions/${id}`).expect(200);
    await userClient.get(`/api/actions/${id}/audit`).expect(200);
    await userClient.post(`/api/actions/${id}/execute`).send(createRefundRequest(2000)).expect(200);
    const pending = await userClient.post('/api/actions').send(createRefundRequest()).expect(201);
    await userClient.post(`/api/actions/${pending.body.requestId}/review`).send({ decision: 'APPROVE' }).expect(403);
    expect(await prisma.approvalRecord.count()).toBe(0);
  });

  it('hides other owners and legacy unowned requests from Users', async () => {
    const created = await request(app).post('/api/actions').send(createRefundRequest(2000)).expect(201);
    const id = created.body.requestId;
    const userClient = client(await startSession(await account('other@example.test')));
    for (const ownerId of [manager.id, null]) {
      await prisma.actionRequest.update({ where: { id }, data: { ownerId } });
      await userClient.get(`/api/actions/${id}`).expect(404);
      await userClient.get(`/api/actions/${id}/audit`).expect(404);
      await userClient.post(`/api/actions/${id}/execute`).send(createRefundRequest(2000)).expect(404);
    }
    expect(await prisma.executionRecord.count()).toBe(0);
    await request(app).get(`/api/actions/${id}`).expect(200);
  });

  it.each(['MANAGER', 'ADMIN'])('lets %s review a User request and records reviewer identity', async role => {
    const owner = await account('owner@example.test');
    await prisma.agent.update({ where: { id: 'SupportAgent-01' }, data: { ownerId: owner.id } });
    const userClient = client(await startSession(owner));
    const reviewer = await account('reviewer@example.test', role);
    const reviewerClient = client(await startSession(reviewer));
    const created = await userClient.post('/api/actions').send(createRefundRequest()).expect(201);
    const id = created.body.requestId;
    await reviewerClient.post(`/api/actions/${id}/review`).send({ decision: 'APPROVE' }).expect(200);
    const record = (await userClient.get(`/api/actions/${id}`).expect(200)).body;
    expect(record.approval.reviewerId).toBe(reviewer.id);
    expect(record.approval.reviewer).toEqual({ id: reviewer.id, email: reviewer.email });
    const events = (await userClient.get(`/api/actions/${id}/audit`).expect(200)).body.events;
    expect(events.find(event => event.event === 'ACTION_REVIEWED').details).toMatchObject({ reviewerId: reviewer.id, reviewerRole: role });
    await userClient.post(`/api/actions/${id}/execute`).send(createRefundRequest()).expect(200);
  });

  it('uses the current database role rather than a stale login role', async () => {
    const created = await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
    await prisma.user.update({ where: { id: manager.id }, data: { role: 'USER' } });
    await request(app).post(`/api/actions/${created.body.requestId}/review`).send({ decision: 'APPROVE' }).expect(403);
    expect((await request(app).get('/api/auth/me').expect(200)).body.user.role).toBe('USER');
  });

  it('refuses legacy approvals without an authenticated reviewer', async () => {
    const created = await request(app).post('/api/actions').send(createRefundRequest()).expect(201);
    const id = created.body.requestId;
    await prisma.actionRequest.update({ where: { id }, data: { status: 'APPROVED', approval: { create: { decision: 'APPROVE', snapshot: createRefundRequest() } } } });
    expect((await request(app).post(`/api/actions/${id}/execute`).send(createRefundRequest()).expect(409)).body.error).toBe('APPROVAL_MISSING');
  });

  it('bounds login attempts', async () => {
    const statuses = [];
    for (let index = 0; index < 21; index++) statuses.push((await login({})).status);
    expect(statuses).toContain(429);
    expect(statuses.every(status => [400, 429].includes(status))).toBe(true);
  });
});
