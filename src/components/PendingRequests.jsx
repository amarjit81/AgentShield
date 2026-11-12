import { useEffect, useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { getPendingActions } from '../services/actions';

export default function PendingRequests({ disabled, selectedId, onSelect, refreshVersion, actionType }) {
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
    <Typography color="text.secondary">Incoming requests appear here automatically. Select one to review its details and approve or reject it.</Typography>
    <Typography variant="body2">Refreshes every 4 seconds · Oldest requests first</Typography>
    {error && <Alert severity="warning">Unable to refresh requests: {error}</Alert>}
    {loading ? <Typography>Loading pending requests...</Typography> : visibleRequests.length === 0 && !error ? <Alert severity="info">No requests in this domain in the loaded approval queue. Select another domain to review its requests.</Alert> : null}
    {hasMore && <Alert severity="info">Filtering the oldest 100 requests across all domains. Older requests must be reviewed before later requests can appear.</Alert>}
    {visibleRequests.length > 0 && <TableContainer><Table size="small" aria-label="Pending action requests">
      <TableHead><TableRow><TableCell>Requester / agent</TableCell><TableCell>Action</TableCell><TableCell>Review</TableCell></TableRow></TableHead>
      <TableBody>{visibleRequests.map(request => <TableRow key={request.requestId} selected={selectedId === request.requestId}>
        <TableCell>{request.owner?.email || 'Unknown owner'}<Typography variant="body2" color="text.secondary">{request.agentId} · {request.target}</Typography><Typography variant="caption">{new Date(request.createdAt).toLocaleString()}</Typography></TableCell>
        <TableCell sx={{ overflowWrap: 'anywhere' }}>{request.action === 'SEND_EMAIL' ? `${request.executionMode === 'SMTP' ? 'Real email' : 'Email simulation'}: ${request.arguments.subject}` : request.action === 'SANDBOX_FILE' ? `Real file: ${request.arguments.operation}` : `Refund: ₹${new Intl.NumberFormat('en-IN').format(request.arguments.amount)}`}</TableCell>
        <TableCell><Button disabled={disabled} onClick={() => onSelect(request.requestId)} aria-label={`Review ${request.agentId} request from ${request.owner?.email || 'unknown owner'}`}>{selectedId === request.requestId ? 'Selected' : 'Review'}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>}
    <Button disabled={disabled} onClick={() => setManualRefresh(value => value + 1)} sx={{ alignSelf: 'flex-start' }}>Refresh requests</Button>
  </Stack>;
}
