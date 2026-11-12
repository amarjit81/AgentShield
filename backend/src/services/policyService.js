import { loadRefundEvaluator, PolicyUnavailableError } from './opaPolicy.js';

// Load once before Express starts. Missing/stale compiled assets stop startup.
const evaluator = await loadRefundEvaluator();
const defaultLimits = { autoApproveLimit: 5000, maxAllowedRefund: 20000, version: 1 };
const outcomes = {
  ALLOW: { status: 'AUTHORIZED', reason: 'Refund is within the auto-approve limit.' },
  REQUIRE_APPROVAL: { status: 'PENDING_APPROVAL', reason: 'Refund exceeds the auto-approve limit and requires human approval.' },
  BLOCK: { status: 'BLOCKED', reason: 'Refund exceeds the maximum allowed amount.' },
};

export function evaluateRefundPolicy(amount, limits = defaultLimits) {
  const policy = { autoApproveLimit: limits.autoApproveLimit, maxAllowedRefund: limits.maxAllowedRefund };
  const version = limits.version ?? 1;
  if (!Number.isFinite(amount) || amount <= 0
    || !Number.isInteger(policy.autoApproveLimit) || policy.autoApproveLimit < 0
    || !Number.isInteger(policy.maxAllowedRefund) || policy.maxAllowedRefund <= 0
    || policy.maxAllowedRefund > 1_000_000_000 || policy.autoApproveLimit > policy.maxAllowedRefund
    || !Number.isInteger(version) || version <= 0) {
    throw new PolicyUnavailableError('Invalid refund policy input or settings.');
  }
  const decision = evaluator.evaluate({ action: 'REFUND', currency: 'INR', amount, limits: policy });
  return {
    decision, ...outcomes[decision], policy,
    policyVersion: `opa-refund-${evaluator.revision}-v${version}`,
    policyEngine: 'opa', policyDigest: evaluator.wasmSha256,
  };
}
