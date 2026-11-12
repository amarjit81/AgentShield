import { z } from 'zod';
import { loadPolicyEvaluator, PolicyUnavailableError } from './opaPolicy.js';
import { emailActionFields } from '../schemas/emailSchema.js';
import { emailSettingsSchema } from '../schemas/policySettingsSchema.js';
import { defaultEmailPolicy } from './policySettingsService.js';

export { emailSettingsSchema } from '../schemas/policySettingsSchema.js';
const evaluator = await loadPolicyEvaluator('email');
const inputSchema = z.object(emailActionFields);
const outcomes = {
  ALLOW: { status: 'AUTHORIZED', reason: 'Recipient belongs to an allowed internal domain.' },
  REQUIRE_APPROVAL: { status: 'PENDING_APPROVAL', reason: 'The email policy requires human approval for this recipient.' },
  BLOCK: { status: 'BLOCKED', reason: 'The recipient is blocked by email policy.' },
};

export function evaluateEmailPolicy(action, configured = defaultEmailPolicy) {
  const validated = inputSchema.safeParse(action);
  if (!validated.success) throw new PolicyUnavailableError('Invalid email policy input.');
  const candidate = { internalDomains: configured.internalDomains, blockedDomains: configured.blockedDomains,
    externalAction: configured.externalAction, version: configured.version };
  const parsedSettings = emailSettingsSchema.safeParse(candidate);
  if (!parsedSettings.success) throw new PolicyUnavailableError('Invalid email policy settings.');
  const settings = parsedSettings.data;
  const recipientDomain = validated.data.target.split('@')[1];
  let decision = evaluator.evaluate({ action: 'SEND_EMAIL', recipientDomain, settings });
  // The checked OPA policy owns domain matching and block precedence. For an
  // otherwise external address, a manager may narrow REQUIRE_APPROVAL to BLOCK.
  if (decision === 'REQUIRE_APPROVAL' && settings.externalAction === 'BLOCK') {
    decision = evaluator.evaluate({ action: 'SEND_EMAIL', recipientDomain,
      settings: { ...settings, blockedDomains: [...settings.blockedDomains, recipientDomain] } });
  }
  return { decision, ...outcomes[decision], policy: structuredClone(settings),
    policyVersion: `opa-email-${evaluator.revision}-v${settings.version}`,
    policyEngine: 'opa', policyDigest: evaluator.wasmSha256 };
}
