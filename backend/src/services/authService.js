import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const secret = process.env.JWT_SECRET;
if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
export const sessionSeconds = 30 * 60;
export const cookieName = 'agentshield_session';
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api' };
const jwtOptions = { algorithm: 'HS256', issuer: 'agentshield', audience: 'agentshield-dashboard' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const publicUser = user => ({ id: user.id, email: user.email, role: user.role });

export async function startSession(user) {
  await prisma.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const session = await prisma.authSession.create({ data: {
    userId: user.id, csrfToken: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + sessionSeconds * 1000),
  } });
  const token = jwt.sign({}, secret, { ...jwtOptions, subject: user.id, jwtid: session.id, expiresIn: sessionSeconds });
  return { token, session };
}

export async function requireAuth(request, response, next) {
  let claims;
  try {
    claims = jwt.verify(request.cookies?.[cookieName] || '', secret, {
      algorithms: ['HS256'], issuer: jwtOptions.issuer, audience: jwtOptions.audience,
    });
  } catch {
    return response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please log in to continue.' });
  }
  if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string' || !uuidPattern.test(claims.sub) || !uuidPattern.test(claims.jti)) {
    return response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please log in to continue.' });
  }
  // Database errors reach the API error handler; they are not mistaken for invalid credentials.
  const session = await prisma.authSession.findUnique({ where: { id: claims.jti }, include: { user: true } });
  if (!session || session.userId !== claims.sub || session.expiresAt <= new Date() || !session.user.active) {
    return response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Your session has ended. Please log in again.' });
  }
  request.user = session.user;
  request.authSession = session;
  next();
}

export function requireCsrf(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const supplied = Buffer.from(request.get('X-CSRF-Token') || '');
  const expected = Buffer.from(request.authSession.csrfToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return response.status(403).json({ error: 'CSRF_INVALID', message: 'Refresh your session before trying again.' });
  }
  next();
}

export const canManage = user => ['MANAGER', 'ADMIN'].includes(user.role);
export function requireManager(request, response, next) {
  if (!canManage(request.user)) return response.status(403).json({ error: 'ROLE_FORBIDDEN', message: 'Only a Manager or Admin can review requests.' });
  next();
}

// Requiring a custom header blocks browser form login CSRF. No cross-origin CORS
// access is enabled. A configured origin also rejects requests from other sites.
export function requireClient(request, response, next) {
  const origin = request.get('Origin');
  const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:5173';
  if (request.get('X-AgentShield-Client') !== 'dashboard' || (origin && origin !== allowedOrigin)) {
    return response.status(403).json({ error: 'ORIGIN_FORBIDDEN', message: 'Use the AgentShield dashboard to log in.' });
  }
  next();
}
