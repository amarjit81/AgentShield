import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { sandboxActionFields } from '../schemas/sandboxSchema.js';

const inputSchema = z.object(sandboxActionFields);

// Pure dry run: no filesystem imports, reads, writes, deletes, or persistent virtual files.
export function simulateSandboxFile(action) {
  const parsed = inputSchema.parse(action);
  if (!parsed.target.startsWith('workspace/') || parsed.target === 'workspace/protected'
    || parsed.target.startsWith('workspace/protected/')) throw new Error('Unsafe sandbox target.');
  const content = parsed.arguments.content;
  return { simulator: 'SANDBOX_FILE', simulated: true, filesystemAccessed: false,
    receiptId: randomUUID(), agentId: action.agentId, target: parsed.target, operation: parsed.arguments.operation,
    ...(content !== undefined ? { content, contentBytes: Buffer.byteLength(content, 'utf8'),
      contentSha256: createHash('sha256').update(content).digest('hex') } : {}) };
}
