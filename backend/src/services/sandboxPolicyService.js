import { z } from 'zod';
import { sandboxActionFields } from '../schemas/sandboxSchema.js';
import { loadPolicyEvaluator, PolicyUnavailableError } from './opaPolicy.js';
import { sandboxSettingsSchema } from '../schemas/policySettingsSchema.js';
import { defaultSandboxPolicy } from './policySettingsService.js';

const evaluator = await loadPolicyEvaluator('sandbox');
const inputSchema = z.object(sandboxActionFields);
const outcomes = {
  ALLOW: { status: 'AUTHORIZED', reason: 'The sandbox policy allows this path and operation.' },
  REQUIRE_APPROVAL: { status: 'PENDING_APPROVAL', reason: 'The sandbox policy requires human approval for this operation.' },
  BLOCK: { status: 'BLOCKED', reason: 'The sandbox policy blocks this path, operation, or content size.' },
};

export function evaluateSandboxPolicy(action, configured = defaultSandboxPolicy) {
  const parsed = inputSchema.safeParse(action);
  if (!parsed.success) throw new PolicyUnavailableError('Invalid sandbox policy input.');
  const candidate = { allowedPaths: configured.allowedPaths, protectedPaths: configured.protectedPaths,
    operationActions: configured.operationActions, maxContentBytes: configured.maxContentBytes, version: configured.version };
  const parsedSettings = sandboxSettingsSchema.safeParse(candidate);
  if (!parsedSettings.success) throw new PolicyUnavailableError('Invalid sandbox policy settings.');
  const settings = parsedSettings.data;
  const { target, arguments: args } = parsed.data;
  const opaInput = { action: parsed.data.action, target, operation: args.operation };
  const hardBoundary = evaluator.evaluate(opaInput);
  const insideAllowedPath = settings.allowedPaths.some(path => target.startsWith(path));
  const insideProtectedPath = settings.protectedPaths.some(path => target.startsWith(path));
  const contentBytes = 'content' in args ? Buffer.byteLength(args.content, 'utf8') : 0;
  let selected = settings.operationActions[args.operation];
  if (hardBoundary === 'BLOCK' || !insideAllowedPath || insideProtectedPath || contentBytes > settings.maxContentBytes) selected = 'BLOCK';
  const canonicalOperation = selected === 'ALLOW' ? 'READ' : selected === 'REQUIRE_APPROVAL' ? 'CHANGE' : 'UNSUPPORTED';
  const decision = evaluator.evaluate({ ...opaInput, operation: canonicalOperation });
  return { decision, ...outcomes[decision],
    policy: structuredClone(settings), policyVersion: `opa-sandbox-${evaluator.revision}-v${settings.version}`,
    policyEngine: 'opa', policyDigest: evaluator.wasmSha256 };
}
