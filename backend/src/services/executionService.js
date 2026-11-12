import { prisma } from '../lib/prisma.js';
import { simulateRefund } from './refundSimulator.js';
import { simulateEmail } from './emailSimulator.js';
import { isDeepStrictEqual } from 'node:util';
import { lockAgent, agentAccessError } from './agentService.js';
import { readEmailDeliveryConfig } from './emailDelivery.js';
import { dispatchReservedEmail } from './emailDispatchService.js';
import { dispatchReservedSandboxFile } from './sandboxDispatchService.js';

export function actionSnapshot(action) {
  return { agentId: action.agentId, action: action.action, target: action.target, arguments: action.arguments,
    ...(action.executionMode === 'SMTP' ? { executionMode: 'SMTP', emailSender: action.emailSender } : {}) };
}

export async function lockAction(transaction, id) {
  // Serialize reviews and executions for this request across backend processes.
  await transaction.$queryRaw`SELECT "id" FROM "ActionRequest" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return transaction.actionRequest.findUnique({ where: { id }, include: { approval: true, execution: true } });
}

export async function executeAction(id, attempted, user) {
  const outcome = await prisma.$transaction(async transaction => {
    const stored = await lockAction(transaction, id);
    if (!stored) return { httpStatus: 404, error: 'ACTION_NOT_FOUND', message: 'No action request was found for this ID.' };
    if (user.role === 'USER' && stored.ownerId !== user.id) {
      return { httpStatus: 404, error: 'ACTION_NOT_FOUND', message: 'No action request was found for this ID.' };
    }

    const deny = async (httpStatus, error, message) => {
      await transaction.auditEvent.create({ data: {
        requestId: id, event: 'EXECUTION_DENIED', status: 'BLOCKED', reason: message,
        details: { code: error, attempted, requestStatus: stored.status, userId: user.id },
      } });
      return { httpStatus, error, message, status: stored.status };
    };

    if (stored.execution || stored.status === 'EXECUTED') {
      if (stored.executionMode === 'SMTP' && stored.execution?.result?.deliveryStatus !== 'ACCEPTED') {
        return deny(409, 'EMAIL_ATTEMPT_EXISTS', 'An email attempt is already reserved. Refresh the receipt and check the sender account/provider; this request will not be resent.');
      }
      if (stored.action === 'SANDBOX_FILE' && stored.execution?.result?.operationStatus === 'DISPATCHING') {
        return deny(409, 'SANDBOX_ATTEMPT_EXISTS', 'A file operation has already been reserved. Inspect the demo workspace before creating a new request.');
      }
      return deny(409, 'REPLAY_DETECTED', 'This request has already executed.');
    }
    if (!['AUTHORIZED', 'APPROVED'].includes(stored.status)) {
      return deny(409, 'ACTION_NOT_AUTHORIZED', 'Only an authorized or approved request can execute.');
    }
    if (stored.status === 'APPROVED' && (stored.approval?.decision !== 'APPROVE' || !stored.approval.reviewerId)) {
      return deny(409, 'APPROVAL_MISSING', 'This request has no saved approval snapshot.');
    }
    const authorized = stored.status === 'APPROVED' ? stored.approval.snapshot : actionSnapshot(stored);
    if (stored.action === 'SANDBOX_FILE' && ['CHANGE', 'DELETE'].includes(stored.arguments.operation)
      && !authorized.fileSha256) {
      return deny(409, 'FILE_PREVIEW_REQUIRED', 'This file approval has no saved preview. Create a new request for Manager review.');
    }
    const matches = authorized.agentId === attempted.agentId && authorized.action === attempted.action
      && authorized.target === attempted.target && isDeepStrictEqual(authorized.arguments, attempted.arguments);
    if (!matches) return deny(409, 'EXECUTION_MISMATCH', 'Execution details do not match the authorized action.');
    if (stored.executionMode === 'SMTP' && (authorized.executionMode !== 'SMTP' || authorized.emailSender !== stored.emailSender)) {
      return deny(409, 'EXECUTION_MISMATCH', 'The saved approval does not match the real email delivery mode and sender.');
    }

    const agent = await lockAgent(transaction, stored.agentId);
    const denied = agentAccessError(agent, stored.ownerId, stored.action);
    if (denied) return deny(403, denied.error, denied.message);

    if (stored.executionMode === 'SMTP') {
      const config = readEmailDeliveryConfig();
      if (config.mode !== 'SMTP' || config.from !== stored.emailSender) {
        return deny(409, 'EMAIL_CONFIGURATION_CHANGED', 'Restore the SMTP mode and sender saved with this request before execution.');
      }
      const result = {
        transport: 'SMTP', simulated: false, delivered: null, deliveryStatus: 'DISPATCHING',
        messageId: `<agentshield.${id}@${config.from.split('@')[1]}>`,
        sender: config.from, recipient: stored.target, ...authorized.arguments,
      };
      const execution = await transaction.executionRecord.create({ data: { requestId: id, result } });
      await transaction.auditEvent.create({ data: {
        requestId: id, event: 'EMAIL_DISPATCH_RESERVED', status: stored.status,
        reason: 'One real email attempt reserved after authorization checks; automatic resend is disabled.',
        details: { executionId: execution.id, messageId: result.messageId, userId: user.id },
      } });
      return { smtp: { requestId: id, execution, config, authorized, userId: user.id } };
    }

    if (stored.action === 'SANDBOX_FILE') {
      const execution = await transaction.executionRecord.create({ data: { requestId: id,
        result: { tool: 'SANDBOX_FILE', simulated: false, filesystemAccessed: null,
          operationStatus: 'DISPATCHING', target: stored.target, operation: stored.arguments.operation } } });
      await transaction.auditEvent.create({ data: { requestId: id, event: 'SANDBOX_FILE_RESERVED', status: stored.status,
        reason: 'One real file operation reserved after authorization checks.',
        details: { executionId: execution.id, userId: user.id } } });
      return { sandbox: { requestId: id, execution, authorized, userId: user.id } };
    }

    const result = stored.action === 'SEND_EMAIL' ? simulateEmail(authorized) : simulateRefund(authorized);
    const execution = await transaction.executionRecord.create({ data: { requestId: id, result } });
    await transaction.actionRequest.update({ where: { id }, data: { status: 'EXECUTED' } });
    await transaction.auditEvent.create({ data: {
      requestId: id, event: stored.action === 'SEND_EMAIL' ? 'EMAIL_SIMULATED' : 'REFUND_EXECUTED', status: 'EXECUTED',
      reason: `Authorized details and current agent permission verified; ${stored.action} simulation recorded.`, details: { executionId: execution.id, result, userId: user.id },
    } });
    return { httpStatus: 200, requestId: id, status: 'EXECUTED', execution };
  }).catch(async error => {
    // The failed transaction leaves authorization reusable and no execution receipt.
    // Record a generic failure separately when the database is still available.
    await prisma.auditEvent.create({ data: {
      requestId: id, event: 'EXECUTION_FAILED', status: 'FAILED',
      reason: 'Execution failed; inspect the saved request status before retrying.', details: { attempted, userId: user.id },
    } }).catch(() => {});
    throw error;
  });
  return outcome.smtp ? dispatchReservedEmail(outcome.smtp)
    : outcome.sandbox ? dispatchReservedSandboxFile(outcome.sandbox) : outcome;
}
