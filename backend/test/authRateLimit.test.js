import { afterEach, describe, expect, it } from 'vitest';
import { loginRateLimitKey } from '../src/routes/authRoutes.js';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe('login rate-limit client key', () => {
  it('uses Vercel trusted client IP and groups IPv6 addresses safely', () => {
    process.env.VERCEL = '1';
    const request = {
      get: (name) => name === 'x-vercel-forwarded-for' ? '2001:db8:abcd:12::1' : undefined,
      socket: { remoteAddress: '127.0.0.1' },
    };

    expect(loginRateLimitKey(request)).toBe('2001:db8:abcd::/56');
  });

  it('ignores spoofable Vercel headers outside Vercel', () => {
    delete process.env.VERCEL;
    const request = {
      get: () => '203.0.113.50',
      socket: { remoteAddress: '127.0.0.1' },
    };

    expect(loginRateLimitKey(request)).toBe('127.0.0.1');
  });
});
