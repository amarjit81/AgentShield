import { z } from 'zod';

// A portable logical path, never an OS path. No normalization can change its meaning.
export const sandboxPathSchema = z.string().min(1).max(240).refine(path =>
  path.split('/').every(part => /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(part)),
'Use lowercase relative paths with forward slashes; no spaces, hidden files, or dot segments.');
const contentSchema = z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 8000,
  'Content must be at most 8,000 UTF-8 bytes.').refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  'Content must be plain text.');
export const sandboxActionFields = {
  action: z.literal('SANDBOX_FILE'),
  target: sandboxPathSchema,
  arguments: z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('READ') }).strict(),
    z.object({ operation: z.literal('WRITE'), content: contentSchema }).strict(),
    z.object({ operation: z.literal('CHANGE'), content: contentSchema }).strict(),
    z.object({ operation: z.literal('DELETE') }).strict(),
  ]),
};
