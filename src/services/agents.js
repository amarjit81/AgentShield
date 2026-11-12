export async function getAgents(signal) {
  const response = await fetch('/api/agents', { credentials: 'same-origin', signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('agentshield-session-ended'));
    const error = new Error(body?.message || 'Unable to load your registered agents.');
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(body?.agents) || !body.agents.every(agent => typeof agent.id === 'string' && typeof agent.name === 'string'
    && typeof agent.active === 'boolean' && Array.isArray(agent.allowedTools) && agent.allowedTools.every(tool => ['REFUND', 'SEND_EMAIL', 'SANDBOX_FILE'].includes(tool)))) {
    throw new Error('The agent API returned an incomplete response.');
  }
  return body.agents;
}
