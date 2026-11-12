import { defineConfig } from 'vitest/config';
import { randomBytes } from 'node:crypto';

export default defineConfig({
  test: {
    fileParallelism: false,
    env: { JWT_SECRET: randomBytes(48).toString('hex'), EMAIL_DELIVERY_MODE: 'SIMULATED' },
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
