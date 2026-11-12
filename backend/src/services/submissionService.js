import { prisma } from '../lib/prisma.js';
import { createActionRecord } from '../repositories/actionRepository.js';
import { evaluateRefundPolicy } from './policyService.js';
import { evaluateEmailPolicy } from './emailPolicyService.js';
import { evaluateSandboxPolicy } from './sandboxPolicyService.js';
import { lockAgent, agentAccessError } from './agentService.js';
import { readEmailPolicy, readRefundPolicy, readSandboxPolicy } from './policySettingsService.js';
import { readEmailDeliveryConfig } from './emailDelivery.js';

export function submitActionRequest(action, userId) {
  return prisma.$transaction(async transaction => {
    // Keep ownership/status stable until the request and its policy are saved.
    const agent = await lockAgent(transaction, action.agentId);
    const denied = agentAccessError(agent, userId, action.action);
    if (denied) return { httpStatus: 403, ...denied };

    const delivery = action.action === 'SEND_EMAIL' ? readEmailDeliveryConfig() : { mode: 'SIMULATED' };
    const policyResult = action.action === 'SEND_EMAIL' ? evaluateEmailPolicy(action, await readEmailPolicy(transaction))
      : action.action === 'SANDBOX_FILE' ? evaluateSandboxPolicy(action, await readSandboxPolicy(transaction))
      : evaluateRefundPolicy(action.arguments.amount, await readRefundPolicy(transaction));
    const storedRequest = await createActionRecord(action, policyResult, userId, transaction, delivery);
    return { httpStatus: 201, storedRequest, policyResult };
  });
}
