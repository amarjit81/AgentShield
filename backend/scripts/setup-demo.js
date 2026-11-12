import { prisma } from '../src/lib/prisma.js';
import { setupDemo } from '../src/services/demoService.js';

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const result = await setupDemo(JSON.parse(input));
  console.log('Presentation accounts and agents are ready. Existing refund records were preserved.');
  for (const account of result.accounts) console.log(`${account.role}: ${account.email}`);
  for (const agent of result.agents) console.log(`${agent.id}: ${agent.active ? 'active' : 'inactive'}; permissions: ${agent.allowedTools.join(', ') || 'none'}`);
} catch (error) {
  if (error.code === 'DEMO_CONFLICT') console.error(error.message);
  else if (error.name === 'ZodError' || error instanceof SyntaxError) console.error('Send JSON on stdin with userPassword and managerPassword (12 characters through 72 UTF-8 bytes). Use scripts/setup-demo.ps1 for hidden prompts.');
  else console.error('Demo not prepared. Check DATABASE_URL and applied migrations. No setup transaction was committed.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
