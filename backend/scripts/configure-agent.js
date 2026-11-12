import { prisma } from '../src/lib/prisma.js';
import { configureAgent } from '../src/services/agentService.js';

const usage = 'Usage: npm run agent:configure -- <agent-id> <active|inactive> <comma-separated REFUND,SEND_EMAIL,SANDBOX_FILE grants|none>';
try {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw Object.assign(new Error(usage), { code: 'INVALID_ARGUMENTS' });
  const [agentId, status, tools] = args;
  const agent = await configureAgent({ agentId, status, allowedTools: tools === 'none' ? [] : tools.split(',') });
  console.log(`Configured ${agent.id}: ${agent.active ? 'active' : 'inactive'}; permissions: ${agent.allowedTools.join(', ') || 'none'}.`);
} catch (error) {
  if (['INVALID_ARGUMENTS', 'AGENT_NOT_REGISTERED'].includes(error.code)) console.error(error.message);
  else if (error.name === 'ZodError') console.error(`Invalid agent ID, status, or permission. ${usage}`);
  else console.error('Agent not configured. Check DATABASE_URL, database availability, and applied migrations.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
