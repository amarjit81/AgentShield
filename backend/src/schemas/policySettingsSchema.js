import { z } from 'zod';

export const refundSettingsSchema = z.object({
  autoApproveLimit: z.number().int().min(0).max(1000000000),
  maxAllowedRefund: z.number().int().min(1).max(1000000000),
  version: z.number().int().min(1).max(2147483646),
}).strict().refine(settings => settings.autoApproveLimit <= settings.maxAllowedRefund);

const domain = z.string().trim().toLowerCase().max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/);
const unique = values => new Set(values).size === values.length;

export const emailSettingsSchema = z.object({
  internalDomains: z.array(domain).max(100).refine(unique),
  blockedDomains: z.array(domain).max(100).refine(unique),
  externalAction: z.enum(['REQUIRE_APPROVAL', 'BLOCK']),
  version: z.number().int().min(1).max(2147483646),
}).strict();

const sandboxPrefix = z.string().trim().toLowerCase().max(240)
  .regex(/^workspace\/(?:[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\/)*$/);
const outcome = z.enum(['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK']);

export const sandboxSettingsSchema = z.object({
  allowedPaths: z.array(sandboxPrefix).min(1).max(100).refine(unique),
  protectedPaths: z.array(sandboxPrefix).max(100).refine(unique),
  operationActions: z.object({ READ: outcome, WRITE: outcome, CHANGE: outcome, DELETE: outcome }).strict(),
  maxContentBytes: z.number().int().min(1).max(8000),
  version: z.number().int().min(1).max(2147483646),
}).strict();
