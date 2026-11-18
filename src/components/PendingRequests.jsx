import { useEffect, useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { getPendingActions } from '../services/actions';
import { motion } from 'motion/react';
import { useInterfaceMotion } from './InterfaceMotion';

const MotionTableRow = motion.create(TableRow);

export default function PendingRequests({ disabled, selectedId, onSelect, refreshVersion, actionType }) {
  const { enabled } = useInterfaceMotion();
  const [requests, setRequests] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manualRefresh, setManualRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const result = await getPendingActions(controller.signal);
        if (controller.signal.aborted) return;
        setRequests(result.requests);
        setHasMore(result.hasMore);
        setError('');
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(poll, 4000);
        }
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refreshVersion, manualRefresh]);

  const visibleRequests = requests.filter(request => request.action === actionType);
  return <Stack spacing={2}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap">
      <Typography variant="body2" color="text.secondary">Oldest requests first · Refreshes every 4 seconds</Typography>
      <Button size="small" disabled={disabled} onClick={() => setManualRefresh(value => value + 1)}>Refresh requests</Button>
    </Stack>
    {error && <Alert severity="warning">Unable to refresh requests: {error}</Alert>}
    {loading ? <Typography role="status">Loading pending requests...</Typography> : visibleRequests.length === 0 && !error ? <Typography className="queue-empty" color="text.secondary">No pending requests for this domain in the loaded queue.</Typography> : null}
    {hasMore && <Alert severity="info">Filtering the oldest 100 requests across all domains. Older requests must be reviewed before later requests can appear.</Alert>}
    {visibleRequests.length > 0 && <TableContainer><Table size="small" aria-label="Pending action requests">
      <TableHead><TableRow><TableCell>Requester / agent</TableCell><TableCell>Action</TableCell><TableCell>Review</TableCell></TableRow></TableHead>
      <TableBody>{visibleRequests.map(request => <MotionTableRow key={request.requestId} initial={enabled ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }} selected={selectedId === request.requestId}>
        <TableCell>{request.owner?.email || 'Unknown owner'}<Typography variant="body2" color="text.secondary">{request.agentId} · {request.target}</Typography><Typography variant="caption">{new Date(request.createdAt).toLocaleString()}</Typography></TableCell>
        <TableCell sx={{ overflowWrap: 'anywhere' }}>{request.action === 'SEND_EMAIL' ? `${request.executionMode === 'SMTP' ? 'Real email' : 'Email simulation'}: ${request.arguments.subject}` : request.action === 'SANDBOX_FILE' ? `Real file: ${request.arguments.operation}` : `Refund: ₹${new Intl.NumberFormat('en-IN').format(request.arguments.amount)}`}</TableCell>
        <TableCell><Button disabled={disabled} onClick={() => onSelect(request.requestId)} aria-label={`Review ${request.agentId} request from ${request.owner?.email || 'unknown owner'}`}>{selectedId === request.requestId ? 'Selected' : 'Review'}</Button></TableCell>
      </MotionTableRow>)}</TableBody>
    </Table></TableContainer>}
  </Stack>;
}
