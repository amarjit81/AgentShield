import { prisma } from '../lib/prisma.js';
import { actionSnapshot, lockAction } from '../services/executionService.js';
import { readSandboxFile } from '../services/sandboxFileTool.js';


export function findPendingActions() {
  return prisma.actionRequest.findMany({
    where: { status: 'PENDING_APPROVAL' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 101,
    select: {
      id: true, agentId: true, action: true, target: true, arguments: true, status: true, executionMode: true, emailSender: true,
      createdAt: true, owner: { select: { email: true } },
    },
  });
}

export function createActionRecord(actionRequest, policyResult, ownerId, database = prisma, delivery = { mode: 'SIMULATED' }) {
  return database.actionRequest.create({
    data: {
      ownerId,
      executionMode: delivery.mode,
      emailSender: delivery.from ?? null,
      agentId: actionRequest.agentId,
      action: actionRequest.action,
      target: actionRequest.target,
      arguments: actionRequest.arguments,
      status: policyResult.status,
      auditEvents: { create: [
        { event: 'REQUEST_RECEIVED', status: 'RECEIVED', reason: 'Action request validated; active registered agent ownership verified.', details: { ...actionRequest, executionMode: delivery.mode, emailSender: delivery.from ?? null, userId: ownerId } },
        { event: 'POLICY_EVALUATED', status: policyResult.status, reason: policyResult.reason, details: { decision: policyResult.decision, policyVersion: policyResult.policyVersion, policyEngine: policyResult.policyEngine, policyDigest: policyResult.policyDigest } },
      ] },
      policyDecision: {
        create: {
          decision: policyResult.decision,
          reason: policyResult.reason,
          policyVersion: policyResult.policyVersion,
          autoApproveLimit: policyResult.policy.autoApproveLimit ?? null,
          maxAllowedRefund: policyResult.policy.maxAllowedRefund ?? null,
          policySnapshot: policyResult.policy,
        },
      },
    },
    include: {
      policyDecision: true,
    },
  });
}

export function findActionRecordById(id) {
  return prisma.actionRequest.findUnique({
    where: { id },
    include: {
      policyDecision: true,
      approval: { include: { reviewer: { select: { id: true, email: true } } } },
      execution: true,
    },
  });
}

export function reviewPendingAction(id, status, reviewer, fileSha256) {
  return prisma.$transaction(async transaction => {
    const stored = await lockAction(transaction, id);
    if (!stored) return { count: 0 };
    if (stored.status !== 'PENDING_APPROVAL') {
      await transaction.auditEvent.create({ data: {
        requestId: id, event: 'REVIEW_DENIED', status: 'BLOCKED',
        reason: 'Only a pending action can be reviewed.', details: { attemptedStatus: status, requestStatus: stored.status, reviewerId: reviewer.id },
      } });
      return { count: 0 };
    }
    let reviewedFileSha256;
    if (status === 'APPROVED' && stored.action === 'SANDBOX_FILE'
      && ['DELETE', 'CHANGE'].includes(stored.arguments.operation)) {
      if (!fileSha256) return { count: 0, previewChanged: true };
      try {
        const current = await readSandboxFile(stored.target);
        if (current.sha256 !== fileSha256) return { count: 0, previewChanged: true };
        reviewedFileSha256 = current.sha256;
      } catch { return { count: 0, previewChanged: true }; }
    }
    const snapshot = { ...actionSnapshot(stored), ...(reviewedFileSha256 ? { fileSha256: reviewedFileSha256 } : {}) };
    await transaction.approvalRecord.create({ data: {
      requestId: id, decision: status === 'APPROVED' ? 'APPROVE' : 'REJECT', snapshot, reviewerId: reviewer.id,
    } });
    await transaction.actionRequest.update({ where: { id }, data: { status } });
    await transaction.auditEvent.create({ data: {
      requestId: id, event: 'ACTION_REVIEWED', status, reason: `Request ${status.toLowerCase()}.`, details: { snapshot, reviewerId: reviewer.id, reviewerRole: reviewer.role },
    } });
    return { count: 1 };
  });
}

export function findAuditEvents(id, after, limit) {
  return prisma.auditEvent.findMany({ where: { requestId: id, id: { gt: after } }, orderBy: { id: 'asc' }, take: limit });
}
