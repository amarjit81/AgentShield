import { Alert, Box, Typography } from '@mui/material';

function receiptText(record) {
  const result = record.execution.result;
  if (result.transport === 'SMTP' && result.simulated === false) {
    if (result.deliveryStatus === 'ACCEPTED') return `SMTP server accepted the email for ${result.recipient}. Inbox delivery is not confirmed.`;
    if (result.deliveryStatus === 'DISPATCHING') return 'Email attempt reserved or in progress. If this persists, check the sender account/provider. This request will not be resent.';
    return 'Email delivery was not confirmed. Check the sender account/provider before creating another request. This request will not be resent.';
  }
  if (record.action === 'SEND_EMAIL') return `Email simulation recorded for ${result.recipient}. No message was delivered.`;
  if (record.action === 'SANDBOX_FILE') {
    if (result.operationStatus === 'DISPATCHING') return 'File operation reserved. Check the demo workspace if this status persists.';
    if (result.operationStatus === 'FAILED') return 'File operation failed. Check the demo workspace before making a new request.';
    return `Real sandbox ${result.operation} completed for ${result.target}.`;
  }
  return `Mock refund of Rs. ${new Intl.NumberFormat('en-IN').format(result.amount)} executed successfully. No money moved.`;
}

export default function ExecutionReceipt({ record }) {
  const result = record.execution.result;
  const realEmail = result.transport === 'SMTP' && result.simulated === false;
  const accepted = result.deliveryStatus === 'ACCEPTED';
  return <Box>
    <Alert severity={(realEmail && !accepted) || result.operationStatus ? 'warning' : 'success'}>{receiptText(record)}</Alert>
    {record.action === 'SANDBOX_FILE' && result.operation === 'READ' && result.content !== undefined && <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.content}</Typography>}
    <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>Execution ID: {record.execution.id}</Typography>
    {(result.messageId || result.refundId || result.receiptId) && <Typography sx={{ overflowWrap: 'anywhere' }}>{realEmail ? 'Message ID' : 'Receipt ID'}: {result.messageId || result.refundId || result.receiptId}</Typography>}
  </Box>;
}
