import { prisma } from '../lib/prisma.js';
import { agentRegistrationSchema, agentConfigurationSchema } from '../schemas/agentSchema.js';

export async function registerAgent(input) {
  const values = agentRegistrationSchema.parse(input);
  const owner = await prisma.user.findUnique({ where: { email: values.ownerEmail } });
  if (!owner) throw Object.assign(new Error('No user exists with this owner email. Create the user first.'), { code: 'OWNER_NOT_FOUND' });
  if (!owner.active) throw Object.assign(new Error('The owner account is inactive. Choose an active user.'), { code: 'OWNER_INACTIVE' });
  // Give a clear duplicate message; the primary key also rejects competing inserts.
  const existing = await prisma.agent.findUnique({ where: { id: values.agentId } });
  if (existing) throw Object.assign(new Error('This agent ID is already registered. Existing agents are not overwritten.'), { code: 'AGENT_EXISTS' });
  return prisma.agent.create({ data: {
    id: values.agentId, name: values.name, ownerId: owner.id, active: values.status === 'active', allowedTools: values.allowedTools,
  } });
}

export async function lockAgent(transaction, id) {
  await transaction.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${id} FOR UPDATE`;
  return transaction.agent.findUnique({ where: { id } });
}

export function agentAccessError(agent, ownerId, tool = 'REFUND') {
  if (!agent) return { error: 'AGENT_NOT_REGISTERED', message: 'Register this agent before submitting an action.' };
  if (!ownerId || agent.ownerId !== ownerId) return { error: 'AGENT_NOT_OWNED', message: 'The registered agent must belong to the request owner.' };
  if (!agent.active) return { error: 'AGENT_INACTIVE', message: 'This agent is inactive and cannot submit actions.' };
  if (!agent.allowedTools.includes(tool)) return { error: 'TOOL_NOT_ALLOWED', message: `This agent does not have ${tool} permission.` };
  return null;
}

export function configureAgent(input) {
  const values = agentConfigurationSchema.parse(input);
  return prisma.$transaction(async transaction => {
    const agent = await lockAgent(transaction, values.agentId);
    if (!agent) throw Object.assign(new Error('No agent is registered with this ID.'), { code: 'AGENT_NOT_REGISTERED' });
    return transaction.agent.update({ where: { id: agent.id }, data: { active: values.status === 'active', allowedTools: values.allowedTools } });
  });
}

export function listOwnedAgents(userId) {
  return prisma.agent.findMany({ where: { ownerId: userId }, orderBy: { id: 'asc' },
    select: { id: true, name: true, active: true, allowedTools: true, updatedAt: true } });
}
