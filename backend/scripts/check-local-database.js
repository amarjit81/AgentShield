import { prisma } from '../src/lib/prisma.js';

try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
