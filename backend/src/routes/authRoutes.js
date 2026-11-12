import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { loginSchema } from '../schemas/authSchema.js';
import { cookieName, cookieOptions, sessionSeconds, startSession, publicUser, requireAuth, requireCsrf, requireClient } from '../services/authService.js';

export const authRouter = Router();
const dummyHash = await bcrypt.hash('not-a-real-account-password', 12);

export function loginRateLimitKey(request) {
  const vercelIp = process.env.VERCEL === '1'
    ? request.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    : undefined;
  const clientIp = vercelIp || request.socket.remoteAddress || request.ip || 'unknown';
  return ipKeyGenerator(clientIp);
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: loginRateLimitKey,
  message: { error: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
});

authRouter.post('/login', requireClient, loginLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'INVALID_LOGIN', message: 'Use a valid email and a password of 12 characters through 72 UTF-8 bytes.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const matches = await bcrypt.compare(parsed.data.password, user?.passwordHash || dummyHash);
  if (!user || !matches || !user.active) return response.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
  const { token, session } = await startSession(user);
  response.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionSeconds * 1000 });
  response.set('Cache-Control', 'no-store');
  return response.json({ user: publicUser(user), csrfToken: session.csrfToken, expiresAt: session.expiresAt });
});

authRouter.get('/me', requireAuth, (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ user: publicUser(request.user), csrfToken: request.authSession.csrfToken, expiresAt: request.authSession.expiresAt });
});

authRouter.post('/logout', requireAuth, requireCsrf, async (request, response) => {
  await prisma.authSession.deleteMany({ where: { id: request.authSession.id } });
  response.clearCookie(cookieName, cookieOptions);
  response.status(204).end();
});
