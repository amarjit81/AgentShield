import { z } from 'zod';
import { emailSchema } from './authSchema.js';

export const agentIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, underscores, or hyphens; start with a letter or number.');
const toolGrantsSchema = z.array(z.enum(['REFUND', 'SEND_EMAIL', 'SANDBOX_FILE'])).max(3)
  .refine(tools => new Set(tools).size === tools.length, 'Tool permissions must be unique.');
export const toolPermissionsSchema = toolGrantsSchema.default([]);
export const agentRegistrationSchema = z.object({
  agentId: agentIdSchema,
  name: z.string().trim().min(1).max(120),
  ownerEmail: emailSchema,
  status: z.enum(['active', 'inactive']).default('active'),
  allowedTools: toolPermissionsSchema,
}).strict();

export const agentConfigurationSchema = z.object({
  agentId: agentIdSchema,
  status: z.enum(['active', 'inactive']),
  allowedTools: toolGrantsSchema,
}).strict();
