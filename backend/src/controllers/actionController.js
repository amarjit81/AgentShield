import {
  findActionRecordById,
  reviewPendingAction,
  findAuditEvents,
  findPendingActions,
} from '../repositories/actionRepository.js';
import {
  actionIdParamsSchema,
  actionRequestSchema,
  actionReviewSchema,
  executionSchema,
  auditQuerySchema,
} from '../schemas/actionSchema.js';
import { submitActionRequest } from '../services/submissionService.js';
import { executeAction } from '../services/executionService.js';
import { canManage } from '../services/authService.js';
import { readSandboxFile } from '../services/sandboxFileTool.js';

function accessible(action, user) { return action && (canManage(user) || action.ownerId === user.id); }

export async function getPendingActions(_request, response) {
  const records = await findPendingActions();
  return response.json({
    requests: records.slice(0, 100).map(({ id, ...record }) => ({ requestId: id, ...record })),
    hasMore: records.length > 100,
  });
}

export async function getSandboxFilePreview(request, response) {
  const params = actionIdParamsSchema.safeParse(request.params);
  if (!params.success) return response.status(400).json({ error: 'INVALID_ACTION_ID', message: 'Use a valid request UUID.' });
  const stored = await findActionRecordById(params.data.id);
  if (!stored) return response.status(404).json({ error: 'ACTION_NOT_FOUND', message: 'No action request was found.' });
  if (stored.action !== 'SANDBOX_FILE' || stored.status !== 'PENDING_APPROVAL'
    || !['DELETE', 'CHANGE'].includes(stored.arguments.operation)) {
    return response.status(409).json({ error: 'PREVIEW_UNAVAILABLE', message: 'Only pending file changes and deletions can be previewed.' });
  }
  try {
    const file = await readSandboxFile(stored.target);
    return response.json({ requestId: stored.id, target: stored.target, content: file.content,
      contentBytes: file.contentBytes, fileSha256: file.sha256 });
  } catch {
    return response.status(409).json({ error: 'PREVIEW_UNAVAILABLE', message: 'The file cannot be previewed. Check that it exists and is readable.' });
  }
}

export async function executeRequestedAction(request, response) {
  const params = actionIdParamsSchema.safeParse(request.params);
  const body = executionSchema.safeParse(request.body);
  if (!params.success || !body.success) {
    return response.status(400).json({ error: 'INVALID_EXECUTION_REQUEST', message: 'Send a valid request UUID and complete action execution details.' });
  }
  const { httpStatus, ...result } = await executeAction(params.data.id, body.data, request.user);
  return response.status(httpStatus).json(result);
}

export async function getAudit(request, response) {
  const params = actionIdParamsSchema.safeParse(request.params);
  const query = auditQuerySchema.safeParse(request.query);
  if (!params.success || !query.success) {
    return response.status(400).json({ error: 'INVALID_AUDIT_QUERY', message: 'Use a valid UUID, nonnegative after cursor, and limit from 1 to 100.' });
  }
  if (!accessible(await findActionRecordById(params.data.id), request.user)) {
    return response.status(404).json({ error: 'ACTION_NOT_FOUND', message: 'No action request was found for this ID.' });
  }
  const events = await findAuditEvents(params.data.id, query.data.after, query.data.limit);
  return response.json({ requestId: params.data.id, events, nextCursor: events.at(-1)?.id ?? query.data.after });
}

export async function reviewAction(request, response) {
  const params = actionIdParamsSchema.safeParse(request.params);
  if (!params.success) {
    return response.status(400).json({
      error: 'INVALID_ACTION_ID',
      message: 'The action ID must be a valid UUID.',
      details: params.error.flatten(),
    });
  }

  const body = actionReviewSchema.safeParse(request.body);
  if (!body.success) {
    return response.status(400).json({
      error: 'INVALID_ACTION_REVIEW',
      message: 'The review must contain only a decision of APPROVE or REJECT.',
      details: body.error.flatten(),
    });
  }

  const status = body.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const updated = await reviewPendingAction(params.data.id, status, request.user, body.data.fileSha256);
  if (updated.previewChanged) return response.status(409).json({ error: 'FILE_PREVIEW_CHANGED',
    message: 'The file is missing or has changed since the preview. Refresh it before approving.' });
  if (updated.count === 0) {
    const existing = await findActionRecordById(params.data.id);
    if (!existing) {
      return response.status(404).json({
        error: 'ACTION_NOT_FOUND',
        message: 'No action request was found for this ID.',
      });
    }
    return response.status(409).json({
      error: 'ACTION_NOT_PENDING',
      message: 'Only a pending action can be approved or rejected.',
      status: existing.status,
    });
  }

  if (status === 'APPROVED') {
    const approved = await findActionRecordById(params.data.id);
    if (approved.action === 'SEND_EMAIL' && approved.executionMode === 'SMTP') {
      const sent = await executeAction(approved.id, {
        agentId: approved.agentId, action: approved.action, target: approved.target, arguments: approved.arguments,
      }, request.user);
      const { httpStatus, ...delivery } = sent;
      return response.status(httpStatus).json({ ...delivery, approved: true });
    }
  }
  return response.status(200).json({ requestId: params.data.id, status });
}

export async function createAction(request, response) {
  const validation = actionRequestSchema.safeParse(request.body);

  if (!validation.success) {
    return response.status(400).json({
      error: 'INVALID_ACTION_REQUEST',
      message: 'The action request is invalid.',
      details: validation.error.flatten(),
    });
  }

  const actionRequest = validation.data;
  const result = await submitActionRequest(actionRequest, request.user.id);
  if (result.error) {
    const { httpStatus, ...body } = result;
    return response.status(httpStatus).json(body);
  }
  const { storedRequest, policyResult } = result;

  return response.status(201).json({
    requestId: storedRequest.id,
    agentId: actionRequest.agentId,
    executionMode: storedRequest.executionMode,
    emailSender: storedRequest.emailSender,
    action: actionRequest.action,
    target: actionRequest.target,
    arguments: actionRequest.arguments,
    ...policyResult,
    receivedAt: storedRequest.createdAt.toISOString(),
  });
}

export async function getAction(request, response) {
  const validation = actionIdParamsSchema.safeParse(request.params);

  if (!validation.success) {
    return response.status(400).json({
      error: 'INVALID_ACTION_ID',
      message: 'The action ID must be a valid UUID.',
      details: validation.error.flatten(),
    });
  }

  const storedRequest = await findActionRecordById(validation.data.id);

  if (!accessible(storedRequest, request.user)) {
    return response.status(404).json({
      error: 'ACTION_NOT_FOUND',
      message: 'No action request was found for this ID.',
    });
  }

  const decision = storedRequest.policyDecision;

  return response.status(200).json({
    requestId: storedRequest.id,
    agentId: storedRequest.agentId,
    executionMode: storedRequest.executionMode,
    emailSender: storedRequest.emailSender,
    action: storedRequest.action,
    target: storedRequest.target,
    arguments: storedRequest.arguments,
    status: storedRequest.status,
    approval: storedRequest.approval,
    execution: storedRequest.execution,
    policyDecision: {
      decision: decision.decision,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      policy: decision.policySnapshot ?? {
        autoApproveLimit: decision.autoApproveLimit,
        maxAllowedRefund: decision.maxAllowedRefund,
      },
      decidedAt: decision.createdAt.toISOString(),
    },
    createdAt: storedRequest.createdAt.toISOString(),
    updatedAt: storedRequest.updatedAt.toISOString(),
  });
}
