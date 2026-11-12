import { Router } from 'express';
import { requireAuth, requireCsrf, requireManager } from '../services/authService.js';
import { readEmailPolicy, readRefundPolicy, readSandboxPolicy, saveEmailPolicy, saveRefundPolicy, saveSandboxPolicy } from '../services/policySettingsService.js';
import { emailSettingsSchema, refundSettingsSchema, sandboxSettingsSchema } from '../schemas/policySettingsSchema.js';

export const policyRouter = Router();
policyRouter.use(requireAuth, requireCsrf, requireManager);
policyRouter.get('/', async (_request, response) => response.json({ policy: await readRefundPolicy() }));
policyRouter.put('/', async (request, response) => {
  const validation = refundSettingsSchema.safeParse(request.body);
  if (!validation.success) return response.status(400).json({ error: 'INVALID_POLICY', message: 'Use whole rupee limits from 0 to 1,000,000,000; maximum must be positive and at least the auto-approve limit. Include the current policy version.' });
  const policy = await saveRefundPolicy(validation.data, request.user.email);
  if (!policy) return response.status(409).json({ error: 'POLICY_CHANGED', message: 'Another manager changed the policy. Reload the current policy before saving again.' });
  return response.json({ policy });
});

policyRouter.get('/email', async (_request, response) => response.json({ policy: await readEmailPolicy() }));
policyRouter.put('/email', async (request, response) => {
  const validation = emailSettingsSchema.safeParse(request.body);
  if (!validation.success) return response.status(400).json({ error: 'INVALID_EMAIL_POLICY',
    message: 'Use valid unique lowercase domains and choose Require approval or Block for other domains. Include the current policy version.' });
  const policy = await saveEmailPolicy(validation.data, request.user.email);
  if (!policy) return response.status(409).json({ error: 'POLICY_CHANGED', message: 'Another manager changed the email policy. Reload it before saving again.' });
  return response.json({ policy });
});

policyRouter.get('/sandbox', async (_request, response) => response.json({ policy: await readSandboxPolicy() }));
policyRouter.put('/sandbox', async (request, response) => {
  const validation = sandboxSettingsSchema.safeParse(request.body);
  if (!validation.success) return response.status(400).json({ error: 'INVALID_SANDBOX_POLICY',
    message: 'Use unique workspace/ folder prefixes, a decision for every operation, and a content limit from 1 to 8,000 bytes. Include the current policy version.' });
  const policy = await saveSandboxPolicy(validation.data, request.user.email);
  if (!policy) return response.status(409).json({ error: 'POLICY_CHANGED', message: 'Another manager changed the sandbox policy. Reload it before saving again.' });
  return response.json({ policy });
});
