import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

afterEach(() => vi.restoreAllMocks());

it('reports a temporary database outage without ending a valid browser session', async () => {
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256', issuer: 'agentshield', audience: 'agentshield-dashboard',
    subject: randomUUID(), jwtid: randomUUID(), expiresIn: 60,
  });
  vi.spyOn(prisma.authSession, 'findUnique').mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P1001' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await request(app).get('/api/agents').set('Cookie', `agentshield_session=${token}`).expect(503);
  expect(result.body).toMatchObject({ error: 'DATABASE_UNAVAILABLE' });
  expect(result.body.message).not.toContain('connection lost');
});
