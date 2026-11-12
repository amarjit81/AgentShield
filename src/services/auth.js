let csrfToken = '';
export function csrfHeaders() { return { 'X-CSRF-Token': csrfToken }; }

async function auth(path, body) {
  const response = await fetch(`/api/auth/${path}`, {
    credentials: 'same-origin',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AgentShield-Client': 'dashboard', ...csrfHeaders() }, body: JSON.stringify(body) } : {}),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || 'Unable to contact the login service.');
    error.status = response.status;
    throw error;
  }
  if (payload) {
    if (!payload.user?.id || !['USER', 'MANAGER', 'ADMIN'].includes(payload.user.role) || typeof payload.csrfToken !== 'string') throw new Error('Invalid login response.');
    csrfToken = payload.csrfToken;
  }
  return payload;
}
export const login = (email, password) => auth('login', { email, password });
export const currentSession = () => auth('me');
export async function logout() { await auth('logout', {}); clearSession(); }
export function clearSession() { csrfToken = ''; }
