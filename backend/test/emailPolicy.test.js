import { describe, expect, it } from 'vitest';
import { evaluateEmailPolicy, emailSettingsSchema } from '../src/services/emailPolicyService.js';
import { loadPolicyEvaluator } from '../src/services/opaPolicy.js';
import { actionRequestSchema } from '../src/schemas/actionSchema.js';

const message = target => ({ agentId: 'Email-Agent', action: 'SEND_EMAIL', target, arguments: { subject: 'Update', body: 'A plain-text update.' } });

describe('OPA email domain policy', () => {
  it.each([
    ['staff@agentshield.test', 'ALLOW'], ['STAFF@AGENTSHIELD.TEST', 'ALLOW'],
    ['staff@team.agentshield.test', 'ALLOW'], ['client@example.com', 'REQUIRE_APPROVAL'],
    ['staff@notagentshield.test', 'REQUIRE_APPROVAL'], ['staff@agentshield.test.evil.example', 'REQUIRE_APPROVAL'],
    ['person@blocked.example', 'BLOCK'], ['person@sub.blocked.example', 'BLOCK'],
    ['person@notblocked.example', 'REQUIRE_APPROVAL'],
  ])('evaluates %s using the real compiled email policy', (recipient, decision) => {
    expect(evaluateEmailPolicy(message(recipient))).toMatchObject({ decision, policyEngine: 'opa', policyVersion: 'opa-email-r1-v1' });
  });

  it('gives the block list precedence over internal domains', async () => {
    const evaluator = await loadPolicyEvaluator('email');
    expect(evaluator.evaluate({ action: 'SEND_EMAIL', recipientDomain: 'team.example.com',
      settings: { internalDomains: ['example.com'], blockedDomains: ['example.com'] } })).toBe('BLOCK');
    expect(evaluator.evaluate({})).toBe('BLOCK');
  });

  it('validates configuration and returns independent policy snapshots', () => {
    expect(emailSettingsSchema.safeParse({ version: 1, internalDomains: ['*.example.com'], blockedDomains: [] }).success).toBe(false);
    const first = evaluateEmailPolicy(message('staff@agentshield.test'));
    first.policy.internalDomains.length = 0;
    expect(evaluateEmailPolicy(message('staff@agentshield.test')).policy.internalDomains).toEqual(['agentshield.test']);
  });

  it('applies versioned custom domain settings', () => {
    const settings = { version: 4, internalDomains: ['company.test'], blockedDomains: ['blocked.test'], externalAction: 'BLOCK' };
    expect(evaluateEmailPolicy(message('person@company.test'), settings)).toMatchObject({ decision: 'ALLOW', policyVersion: 'opa-email-r1-v4' });
    expect(evaluateEmailPolicy(message('person@outside.test'), settings)).toMatchObject({ decision: 'BLOCK', policyVersion: 'opa-email-r1-v4' });
  });

  it('normalizes a single recipient but preserves message text exactly', () => {
    const input = message(' STAFF@AGENTSHIELD.TEST ');
    input.arguments = { subject: ' Update ', body: '  First line\r\nSecond line  ' };
    expect(actionRequestSchema.parse(input)).toEqual({ ...input, target: 'staff@agentshield.test' });
  });
});
