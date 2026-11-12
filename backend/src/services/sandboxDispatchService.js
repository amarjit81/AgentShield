import { prisma } from '../lib/prisma.js';
import { executeSandboxFile } from './sandboxFileTool.js';

// A durable reservation is committed before touching disk. A failed or uncertain
// file operation is not replayed under the same request ID.
export async function dispatchReservedSandboxFile(reservation) {
  const { requestId, execution, authorized, userId } = reservation;
  let result;
  let succeeded = false;
  try {
    result = await executeSandboxFile(authorized);
    succeeded = true;
  } catch (error) {
    result = { ...execution.result, operationStatus: 'FAILED', message: 'File operation failed. Check the demo workspace before creating a new request.' };
  }
  try {
    const saved = await prisma.$transaction(async transaction => {
      const receipt = await transaction.executionRecord.update({ where: { id: execution.id }, data: { result } });
      await transaction.actionRequest.update({ where: { id: requestId }, data: { status: succeeded ? 'EXECUTED' : 'FAILED' } });
      await transaction.auditEvent.create({ data: { requestId,
        event: succeeded ? 'SANDBOX_FILE_EXECUTED' : 'SANDBOX_FILE_FAILED', status: succeeded ? 'EXECUTED' : 'FAILED',
        reason: succeeded ? 'Real sandbox file operation completed in the dedicated demo directory.' : result.message,
        details: { executionId: execution.id, result, userId } } });
      return receipt;
    });
    return succeeded ? { httpStatus: 200, requestId, status: 'EXECUTED', execution: saved }
      : { httpStatus: 500, requestId, status: 'FAILED', execution: saved, error: 'SANDBOX_FILE_FAILED', message: result.message };
  } catch {
    return { httpStatus: 503, requestId, error: 'SANDBOX_OUTCOME_UNKNOWN',
      message: 'The file operation could not be finalized in storage. Inspect the demo workspace before creating a new request.' };
  }
}
