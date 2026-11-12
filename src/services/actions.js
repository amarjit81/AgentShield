import { csrfHeaders } from './auth';

async function api(path, options = {}) {
  const response = await fetch(`/api/actions${path}`, { credentials: 'same-origin', ...options });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('agentshield-session-ended'));
    const error = new Error(payload?.message || `Action API returned HTTP ${response.status}.`);
    error.code = payload?.error;
    throw error;
  }
  if (!payload || typeof payload !== 'object') throw new Error('Action API returned an incomplete response.');
  return payload;
}

function post(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...csrfHeaders() }, body: JSON.stringify(body) };
}

export function createAction(body) {
  return api('', post(body));
}

export async function getEmailDelivery(signal) {
  const payload = await api('/email-delivery', { signal });
  if (!['SMTP', 'SIMULATED'].includes(payload.mode) || typeof payload.ready !== 'boolean'
    || !Array.isArray(payload.allowedRecipients)) throw new Error('Invalid email delivery configuration response.');
  return payload;
}

export function getAction(id, signal) {
  return api(`/${encodeURIComponent(id)}`, { signal });
}

export function getSandboxFilePreview(id, signal) {
  return api(`/${encodeURIComponent(id)}/file-preview`, { signal });
}

export async function getPendingActions(signal) {
  const payload = await api('/pending', { signal });
  if (!Array.isArray(payload.requests) || typeof payload.hasMore !== 'boolean') throw new Error('Invalid pending-request response.');
  return payload;
}

export async function getAudit(id, signal) {
  const events = [];
  let after = 0;
  while (true) {
    const page = await api(`/${encodeURIComponent(id)}/audit?after=${after}&limit=100`, { signal });
    if (!Array.isArray(page.events) || !Number.isInteger(page.nextCursor)) throw new Error('Invalid audit response.');
    events.push(...page.events);
    if (page.events.length < 100) return events;
    if (page.nextCursor <= after) throw new Error('Invalid audit cursor.');
    after = page.nextCursor;
  }
}

export function executeAction(id, body) {
  return api(`/${encodeURIComponent(id)}/execute`, post(body));
}

export async function reviewAction(requestId, decision, fileSha256) {
  const payload = await api(`/${encodeURIComponent(requestId)}/review`, post({ decision, ...(fileSha256 ? { fileSha256 } : {}) }));
  const expectedStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (payload?.requestId !== requestId || payload?.status !== expectedStatus) {
    throw new Error('Review API returned an incomplete or unexpected response.');
  }
  return payload;
}
