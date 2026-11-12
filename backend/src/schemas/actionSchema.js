import { z } from 'zod';
import { emailActionFields } from './emailSchema.js';
import { sandboxActionFields } from './sandboxSchema.js';

const refundRequestSchema = z.object({
  agentId: z.string().trim().min(1, 'Agent ID is required.'),
  action: z.literal('REFUND'),
  target: z.string().trim().min(1, 'Target is required.'),
  arguments: z.object({
    amount: z.number().positive('Refund amount must be greater than zero.'),
    currency: z.literal('INR').default('INR'),
  }),
});

const emailRequestSchema = z.object({ agentId: z.string().trim().min(1).max(64), ...emailActionFields }).strict();
const sandboxRequestSchema = z.object({ agentId: z.string().trim().min(1).max(64), ...sandboxActionFields }).strict();
export const actionRequestSchema = z.discriminatedUnion('action', [refundRequestSchema, emailRequestSchema, sandboxRequestSchema]);

export const actionIdParamsSchema = z.object({
  id: z.string().uuid('Action ID must be a valid UUID.'),
});

export const actionReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

const refundExecutionSchema = refundRequestSchema.extend({
  arguments: z.object({ amount: z.number().positive(), currency: z.string().min(1).max(8) }).strict(),
}).strict();
export const executionSchema = z.discriminatedUnion('action', [refundExecutionSchema, emailRequestSchema, sandboxRequestSchema]);

export const auditQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
