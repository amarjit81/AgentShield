import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { passwordSchema } from '../schemas/authSchema.js';

export const demoAccounts = [
  { email: 'user@agentshield.test', role: 'USER', passwordField: 'userPassword' },
  { email: 'manager@agentshield.test', role: 'MANAGER', passwordField: 'managerPassword' },
];
export const demoAgents = [
  { id: 'Demo-Sandbox', name: 'Sandbox File Agent', active: true, allowedTools: ['SANDBOX_FILE'] },
  { id: 'Demo-Email', name: 'Email Agent', active: true, allowedTools: ['SEND_EMAIL'] },
  { id: 'Demo-Refund', name: 'Refund Agent', active: true, allowedTools: ['REFUND'] },
  { id: 'Demo-NoRefund', name: 'Agent without refund permission', active: true, allowedTools: [] },
  { id: 'Demo-Disabled', name: 'Disabled Agent', active: false, allowedTools: ['REFUND'] },
  { id: 'Demo-Revocable', name: 'Agent for revocation demo', active: true, allowedTools: ['REFUND'] },
];
const setupSchema = z.object({ userPassword: passwordSchema, managerPassword: passwordSchema }).strict();

export async function setupDemo(input) {
  const passwords = setupSchema.parse(input);
  // Hash before starting a database transaction, keeping the lock interval short.
  const hashes = await Promise.all(demoAccounts.map(account => bcrypt.hash(passwords[account.passwordField], 12)));
  return prisma.$transaction(async transaction => {
    const users = [];
    for (const [index, account] of demoAccounts.entries()) {
      let user = await transaction.user.findUnique({ where: { email: account.email } });
      if (user && (user.role !== account.role || !user.active || !await bcrypt.compare(passwords[account.passwordField], user.passwordHash))) {
        throw Object.assign(new Error(`Demo account ${account.email} already exists with different credentials, role, or status. No records were changed.`), { code: 'DEMO_CONFLICT' });
      }
      if (!user) user = await transaction.user.create({ data: { email: account.email, role: account.role, passwordHash: hashes[index] } });
      users.push(user);
    }
    for (const values of demoAgents) {
      const existing = await transaction.agent.findUnique({ where: { id: values.id } });
      if (existing && existing.ownerId !== users[0].id) {
        throw Object.assign(new Error(`Demo agent ${values.id} belongs to another owner. No records were changed.`), { code: 'DEMO_CONFLICT' });
      }
      await transaction.agent.upsert({ where: { id: values.id }, create: { ...values, ownerId: users[0].id }, update: values });
    }
    return { accounts: users.map(user => ({ email: user.email, role: user.role })), agents: demoAgents };
  }, { timeout: 15000 });
}
