import { prisma } from '../src/lib/prisma.js';
import { registerAgent } from '../src/services/agentService.js';

const usage = 'Usage: npm run agent:register -- <agent-id> "<name>" <owner-email> [active|inactive] [comma-separated REFUND,SEND_EMAIL,SANDBOX_FILE grants|none]';
try {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.length > 5) throw Object.assign(new Error(usage), { code: 'INVALID_ARGUMENTS' });
  const [agentId, name, ownerEmail, status, tools = 'none'] = args;
  const agent = await registerAgent({ agentId, name, ownerEmail, status, allowedTools: tools === 'none' ? [] : tools.split(',') });
  console.log(`Registered ${agent.active ? 'active' : 'inactive'} agent ${agent.id} (${agent.name}) for owner ${agent.ownerId}. Permissions: ${agent.allowedTools.join(', ') || 'none'}.`);
} catch (error) {
  if (['OWNER_NOT_FOUND', 'OWNER_INACTIVE', 'AGENT_EXISTS', 'INVALID_ARGUMENTS'].includes(error.code)) console.error(error.message);
  else if (error.name === 'ZodError') console.error(`Invalid registration: ${error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}\n${usage}`);
  else if (error.code === 'P2002') console.error('This agent ID is already registered. Existing agents are not overwritten.');
  else if (error.code === 'P2003') console.error('The owner no longer exists. Choose an existing user.');
  else console.error('Agent not registered. Check DATABASE_URL, database availability, and applied migrations.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
