import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { registerAgent } from '../src/services/agentService.js';

if (process.env.AGENTSHIELD_TEST_DATABASE !== '1') throw new Error('Set AGENTSHIELD_TEST_DATABASE=1 only with an isolated disposable test database.');
let owner;
const registration = changes => ({ agentId: 'SupportAgent-01', name: 'Support Agent', ownerEmail: owner.email, ...changes });
beforeEach(async () => {
  await prisma.$disconnect();
  await prisma.actionRequest.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
  owner = await prisma.user.create({ data: { email: 'owner@example.test', passwordHash: 'unused-registration-test-hash', role: 'USER' } });
});
afterAll(async () => { await prisma.agent.deleteMany(); await prisma.$disconnect(); });

async function command(args) {
  // Release the parent connection before a separate CLI process uses the test DB.
  await prisma.$disconnect();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/register-agent.js', ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('Local agent registration', () => {
  it('persists a normalized registration with an active default and real owner relationship', async () => {
    const created = await registerAgent(registration({ agentId: ' SupportAgent-01 ', name: ' Support Agent ', ownerEmail: ' OWNER@EXAMPLE.TEST ' }));
    expect(created).toMatchObject({ id: 'SupportAgent-01', name: 'Support Agent', ownerId: owner.id, active: true });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
    const stored = await prisma.agent.findUnique({ where: { id: created.id }, include: { owner: true } });
    expect(stored.owner.email).toBe(owner.email);
  });

  it('supports explicit inactive status', async () => {
    expect((await registerAgent(registration({ status: 'inactive' }))).active).toBe(false);
  });

  it('rejects duplicate IDs without transferring ownership, renaming, or reactivating an agent', async () => {
    const first = await registerAgent(registration({ status: 'inactive' }));
    await prisma.user.create({ data: { email: 'other@example.test', passwordHash: 'unused-registration-test-hash' } });
    await expect(registerAgent(registration({ name: 'Changed', ownerEmail: 'other@example.test', status: 'active' }))).rejects.toMatchObject({ code: 'AGENT_EXISTS' });
    expect(await prisma.agent.findUnique({ where: { id: first.id } })).toEqual(first);
    expect(await prisma.agent.count()).toBe(1);
    // The database also protects against inserts that bypass the service's check.
    await expect(prisma.agent.create({ data: { id: first.id, name: 'Changed', ownerId: owner.id } })).rejects.toThrow();
  });

  it('rejects unknown and inactive owners without creating an agent', async () => {
    await expect(registerAgent(registration({ ownerEmail: 'missing@example.test' }))).rejects.toMatchObject({ code: 'OWNER_NOT_FOUND' });
    await prisma.user.update({ where: { id: owner.id }, data: { active: false } });
    await expect(registerAgent(registration())).rejects.toMatchObject({ code: 'OWNER_INACTIVE' });
    expect(await prisma.agent.count()).toBe(0);
  });

  it('prevents orphaned agents when an owner is deleted or missing', async () => {
    await registerAgent(registration());
    await expect(prisma.user.delete({ where: { id: owner.id } })).rejects.toThrow();
    await expect(prisma.agent.create({ data: { id: 'Orphan', name: 'Orphan', ownerId: '00000000-0000-4000-8000-000000000000' } })).rejects.toThrow();
    expect(await prisma.agent.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  it.each([
    ['empty ID', { agentId: ' ' }],
    ['overlong ID', { agentId: 'a'.repeat(65) }],
    ['ID containing a slash', { agentId: 'agent/one' }],
    ['ID starting with a hyphen', { agentId: '-agent' }],
    ['empty name', { name: ' ' }],
    ['overlong name', { name: 'a'.repeat(121) }],
    ['invalid owner email', { ownerEmail: 'not-an-email' }],
    ['invalid status', { status: 'true' }],
    ['unexpected input fields', { role: 'ADMIN' }],
  ])('rejects %s', async (_label, changes) => {
    await expect(registerAgent(registration(changes))).rejects.toMatchObject({ name: 'ZodError' });
    expect(await prisma.agent.count()).toBe(0);
  });

  it('registers through the command and returns a useful duplicate error with a failing exit code', async () => {
    const result = await command(['SupportAgent-01', 'Support Agent', ' OWNER@EXAMPLE.TEST ']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Registered active agent SupportAgent-01');
    expect(result.stderr).toBe('');
    const duplicate = await command(['SupportAgent-01', 'Changed Name', owner.email, 'inactive']);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('already registered');
    expect(await prisma.agent.findUnique({ where: { id: 'SupportAgent-01' } })).toMatchObject({ name: 'Support Agent', active: true });
  });

  it('registers an inactive agent through the command', async () => {
    const result = await command(['SupportAgent-01', 'Support Agent', owner.email, 'inactive']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Registered inactive agent');
    expect((await prisma.agent.findUnique({ where: { id: 'SupportAgent-01' } })).active).toBe(false);
  });

  it('reports invalid arguments, validation, and missing owners through the command', async () => {
    for (const args of [[], ['id', 'name', owner.email, 'active', 'extra']]) {
      const result = await command(args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Usage:');
    }
    const invalid = await command(['agent/one', 'Support', owner.email]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('Invalid registration');
    const missing = await command(['SupportAgent-01', 'Support Agent', 'missing@example.test']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Create the user first');
    expect(await prisma.agent.count()).toBe(0);
  });
});
