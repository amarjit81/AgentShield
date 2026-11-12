import { randomUUID } from 'node:crypto';

// Record a receipt only. There is no mail transport, provider, or delivery call.
export function simulateEmail(action) {
  return { simulator: 'SEND_EMAIL', simulated: true, delivered: false,
    messageId: randomUUID(), agentId: action.agentId, recipient: action.target,
    subject: action.arguments.subject, body: action.arguments.body };
}
