import { randomUUID } from 'node:crypto';

// This function creates a receipt only. It never calls a payment service.
export function simulateRefund(action) {
  return {
    simulator: 'REFUND',
    simulated: true,
    refundId: randomUUID(),
    agentId: action.agentId,
    target: action.target,
    amount: action.arguments.amount,
    currency: action.arguments.currency,
  };
}
