import { prisma } from '../lib/prisma.js';
import { sendSmtpEmail } from './emailDelivery.js';

// Reservation is already committed before this function makes an external call.
// Never resend a reserved request: a timeout may happen after SMTP acceptance.
export async function dispatchReservedEmail(reservation) {
  const { requestId, execution, config, authorized, userId } = reservation;
  let result;
  let accepted = false;
  try {
    const delivery = await sendSmtpEmail(config, authorized, execution.result.messageId);
    result = { ...execution.result, ...delivery, deliveryStatus: 'ACCEPTED' };
    accepted = true;
  } catch {
    // Do not expose SMTP errors: they may contain credentials or provider details.
    result = { ...execution.result, deliveryStatus: 'UNKNOWN',
      message: 'Delivery was not confirmed. Check the sender account/provider before creating another request. This request will not be resent.' };
  }

  try {
    const saved = await prisma.$transaction(async transaction => {
      const receipt = await transaction.executionRecord.update({ where: { id: execution.id }, data: { result } });
      await transaction.actionRequest.update({ where: { id: requestId }, data: { status: accepted ? 'EXECUTED' : 'FAILED' } });
      await transaction.auditEvent.create({ data: {
        requestId, event: accepted ? 'EMAIL_ACCEPTED' : 'EMAIL_DELIVERY_UNKNOWN', status: accepted ? 'EXECUTED' : 'FAILED',
        reason: accepted ? 'SMTP server accepted the email; inbox delivery is not confirmed.' : result.message,
        details: { executionId: execution.id, messageId: result.messageId, userId },
      } });
      return receipt;
    });
    if (accepted) return { httpStatus: 200, requestId, status: 'EXECUTED', execution: saved };
    return { httpStatus: 502, requestId, status: 'FAILED', execution: saved,
      error: 'EMAIL_DELIVERY_UNKNOWN', message: result.message };
  } catch {
    // Provider acceptance cannot be rolled back. Keep the durable reservation.
    return { httpStatus: 503, requestId, error: 'EMAIL_OUTCOME_UNKNOWN',
      message: 'The email attempt could not be finalized in storage. It will not be resent. Refresh the request and check the sender account/provider.' };
  }
}
