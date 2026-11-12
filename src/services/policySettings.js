import { csrfHeaders } from './auth';

async function request(path, validate, options = {}) {
  const response = await fetch(`/api/policy${path}`, { credentials: 'same-origin', ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('agentshield-session-ended'));
    throw new Error(payload?.message || 'Unable to load or save policy settings.');
  }
  const policy = payload?.policy;
  if (!validate(policy)) throw new Error('Invalid policy settings response.');
  return policy;
}
const refundPolicy = policy => Number.isInteger(policy?.autoApproveLimit) && Number.isInteger(policy?.maxAllowedRefund) && Number.isInteger(policy?.version);
const emailPolicy = policy => Array.isArray(policy?.internalDomains) && Array.isArray(policy?.blockedDomains)
  && ['REQUIRE_APPROVAL', 'BLOCK'].includes(policy?.externalAction) && Number.isInteger(policy?.version);
const sandboxPolicy = policy => Array.isArray(policy?.allowedPaths) && Array.isArray(policy?.protectedPaths)
  && ['READ', 'WRITE', 'CHANGE', 'DELETE'].every(operation => ['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'].includes(policy?.operationActions?.[operation]))
  && Number.isInteger(policy?.maxContentBytes) && Number.isInteger(policy?.version);
const save = (path, validate, settings) => request(path, validate, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...csrfHeaders() }, body: JSON.stringify(settings) });

export const getPolicySettings = signal => request('', refundPolicy, { signal });
export const savePolicySettings = settings => save('', refundPolicy, settings);
export const getEmailPolicySettings = signal => request('/email', emailPolicy, { signal });
export const saveEmailPolicySettings = settings => save('/email', emailPolicy, settings);
export const getSandboxPolicySettings = signal => request('/sandbox', sandboxPolicy, { signal });
export const saveSandboxPolicySettings = settings => save('/sandbox', sandboxPolicy, settings);
