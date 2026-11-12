import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { accountSchema } from '../src/schemas/authSchema.js';

// Read the password from stdin rather than command arguments or shell history.
try {
  let password = '';
  for await (const chunk of process.stdin) password += chunk;
  const account = accountSchema.parse({ email: process.argv[2], role: process.argv[3] || 'USER', password: password.replace(/\r?\n$/, '') });
  const passwordHash = await bcrypt.hash(account.password, 12);
  const user = await prisma.user.create({ data: { email: account.email, role: account.role, passwordHash } });
  console.log(`Created ${user.role} account: ${user.email}`);
} catch (error) {
  if (error.code === 'P2002') console.error('This email already has an account.');
  else if (error.name === 'ZodError') console.error('Account not created. Use a valid email, USER/MANAGER/ADMIN role, and a password of 12 characters through 72 UTF-8 bytes on stdin.');
  else console.error('Account not created. Check DATABASE_URL, database availability, and applied migrations.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
