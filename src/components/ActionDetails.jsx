import { Box, Typography } from '@mui/material';

export default function ActionDetails({ action }) {
  if (action.action === 'REFUND') return <Typography>Refund: ₹{new Intl.NumberFormat('en-IN').format(action.arguments.amount)} {action.arguments.currency}</Typography>;
  if (action.action === 'SANDBOX_FILE') return <Box sx={{ overflowWrap: 'anywhere' }}>
    <Typography><strong>Sandbox file:</strong> {action.arguments.operation} {action.target}</Typography>
    <Typography>Real file operations stay inside the dedicated AgentShield demo workspace.</Typography>
    {['WRITE', 'CHANGE'].includes(action.arguments.operation) && <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontWeight: 700 }}>{action.arguments.operation === 'CHANGE' ? 'Proposed replacement content' : 'Proposed new file content'}</Typography>
      <Box component="pre" sx={{ m: 0, mt: 1, p: 2, border: '1px solid', borderColor: 'divider', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflowY: 'auto' }}>{action.arguments.content || '(empty file)'}</Box>
    </Box>}
  </Box>;
  return <Box sx={{ overflowWrap: 'anywhere' }}>
    <Typography><strong>Delivery:</strong> {action.executionMode === 'SMTP' ? `Real email from ${action.emailSender}` : 'Simulation; nothing is sent'}</Typography>
    <Typography><strong>Recipient:</strong> {action.target}</Typography>
    <Typography sx={{ whiteSpace: 'pre-wrap' }}><strong>Subject:</strong> {action.arguments.subject}</Typography>
    <Typography component="div" sx={{ mt: 1, p: 2, border: '1px solid', borderColor: 'divider', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{action.arguments.body}</Typography>
  </Box>;
}
