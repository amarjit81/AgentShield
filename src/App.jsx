import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CssBaseline, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { createAction, executeAction, getAction, getAudit, reviewAction, getEmailDelivery, getSandboxFilePreview } from './services/actions';
import AuthGate from './components/AuthGate';
import AgentPicker from './components/AgentPicker';
import PendingRequests from './components/PendingRequests';
import PolicySettings from './components/PolicySettings';
import EmailPolicySettings from './components/EmailPolicySettings';
import SandboxPolicySettings from './components/SandboxPolicySettings';
import EmailFields from './components/EmailFields';
import SandboxFields from './components/SandboxFields';
import ActionDetails from './components/ActionDetails';
import ExecutionReceipt from './components/ExecutionReceipt';
import DomainSelector, { domains } from './components/DomainSelector';

const theme = createTheme({
  palette: { primary: { main: '#2b3037' }, background: { default: '#f4f5f7' } },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  components: { MuiButton: { styleOverrides: { root: { textTransform: 'none' } } } },
});
const money = value => `Rs. ${new Intl.NumberFormat('en-IN').format(value)}`;
const storageKey = 'agentshield-request-id';
function savedId(userId) { try { return localStorage.getItem(`${storageKey}:${userId}`) || ''; } catch { return ''; } }
function remember(id, userId) { try { if (id) localStorage.setItem(`${storageKey}:${userId}`, id); else localStorage.removeItem(`${storageKey}:${userId}`); } catch { /* Persistence is optional. */ } }
function Section({ title, children }) {
  return <Paper component="section" variant="outlined" sx={{ p: 3, minWidth: 0 }}><Typography variant="h6" sx={{ mb: 2 }}>{title}</Typography>{children}</Paper>;
}
function Row({ label, value }) {
  return <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: .6 }}><Typography color="text.secondary">{label}</Typography><Typography sx={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{value}</Typography></Box>;
}

export default function App() {
  return <ThemeProvider theme={theme}><CssBaseline /><AuthGate>{(user, onLogout) => <Dashboard key={user.id} user={user} onLogout={onLogout} />}</AuthGate></ThemeProvider>;
}

function Dashboard({ user, onLogout }) {
  const isReviewer = ['MANAGER', 'ADMIN'].includes(user.role);
  const [queueVersion, setQueueVersion] = useState(0);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [amount, setAmount] = useState('8000');
  const [actionType, setActionType] = useState('REFUND');
  const [sandbox, setSandbox] = useState({ operation: 'WRITE', path: 'workspace/notes.txt', content: 'Sandbox demonstration.' });
  const [emailDelivery, setEmailDelivery] = useState(null);
  const [deliveryError, setDeliveryError] = useState('');
  const [email, setEmail] = useState({ recipient: 'colleague@agentshield.test', subject: 'Project update', body: 'The project update is ready for review.' });
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [requestId, setRequestId] = useState(() => savedId(user.id));
  const [lookup, setLookup] = useState(() => savedId(user.id));
  const [record, setRecord] = useState(null);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const [filePreview, setFilePreview] = useState(null);
  const [filePreviewError, setFilePreviewError] = useState('');
  const selectedId = useRef(requestId);
  const working = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const config = await getEmailDelivery(controller.signal);
        if (!controller.signal.aborted) {
          setEmailDelivery(config); setDeliveryError('');
          if (config.mode === 'SMTP' && config.ready && config.allowedRecipients.length) {
            setEmail(previous => previous.recipient === 'colleague@agentshield.test'
              ? { ...previous, recipient: config.allowedRecipients[0] } : previous);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) { setEmailDelivery(null); setDeliveryError(err.message); }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  function select(id) {
    selectedId.current = id;
    remember(id, user.id);
    setRequestId(id);
    setLookup(id);
    setRecord(null);
    setAudit([]);
    setSyncError('');
    setFilePreview(null);
    setFilePreviewError('');
  }

  function changeDomain(action) {
    if (action === actionType) return;
    setActionType(action);
    setSelectedAgent(null);
    select('');
    setError('');
    setNotice('');
  }

  async function refresh(id, signal) {
    const [action, events] = await Promise.all([getAction(id, signal), getAudit(id, signal)]);
    if (action.requestId !== id || !action.arguments || !action.policyDecision) throw new Error('Action API returned an incomplete record.');
    if (selectedId.current === id && !signal?.aborted && !(signal && working.current)) {
      setRecord(action);
      setActionType(action.action);
      setAudit(events);
      setSyncError('');
    }
  }

  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try {
        if (!working.current) await refresh(requestId, controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) setSyncError(err.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [requestId]);

  useEffect(() => {
    if (!isReviewer || record?.requestId !== requestId || record?.action !== 'SANDBOX_FILE'
      || record.status !== 'PENDING_APPROVAL' || !['CHANGE', 'DELETE'].includes(record.arguments.operation)) return;
    const controller = new AbortController();
    setFilePreview(null);
    setFilePreviewError('');
    getSandboxFilePreview(requestId, controller.signal).then(preview => {
      if (!controller.signal.aborted) setFilePreview(preview);
    }).catch(err => { if (!controller.signal.aborted) setFilePreviewError(err.message); });
    return () => controller.abort();
  }, [isReviewer, requestId, record?.requestId, record?.status, record?.action, record?.arguments?.operation]);

  async function refreshFilePreview() {
    setFilePreview(null);
    setFilePreviewError('');
    try { setFilePreview(await getSandboxFilePreview(requestId)); }
    catch (err) { setFilePreviewError(err.message); }
  }

  async function run(work) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally {
      try { if (selectedId.current) await refresh(selectedId.current); }
      catch (err) { setSyncError(`Unable to refresh saved status: ${err.message}`); }
      working.current = false;
      setBusy(false);
    }
  }

  function submit() {
    run(async () => {
      if (!selectedAgent) throw new Error('Select a registered agent before submitting.');
      const body = actionType === 'SEND_EMAIL'
        ? { agentId: selectedAgent.id, action: 'SEND_EMAIL', target: email.recipient, arguments: { subject: email.subject, body: email.body } }
        : actionType === 'SANDBOX_FILE' ? { agentId: selectedAgent.id, action: 'SANDBOX_FILE', target: sandbox.path,
          arguments: { operation: sandbox.operation, ...(['WRITE', 'CHANGE'].includes(sandbox.operation) ? { content: sandbox.content } : {}) } }
        : { agentId: selectedAgent.id, action: 'REFUND', target: 'Customer-123', arguments: { amount: Number(amount), currency: 'INR' } };
      const created = await createAction(body);
      if (!created.requestId || !['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'].includes(created.decision)) throw new Error('Invalid action response.');
      select(created.requestId);
      if (created.decision === 'ALLOW') {
        if (created.executionMode === 'SMTP') {
          setNotice('Policy authorized the real email. Review the saved details, then click Send Real Email.');
        } else {
          await executeAction(created.requestId, { agentId: created.agentId, action: created.action, target: created.target, arguments: created.arguments });
          setNotice(created.action === 'SANDBOX_FILE' ? 'The real sandbox file operation completed in the demo workspace.'
            : `Policy allowed the request; the backend recorded a simulated ${created.action === 'SEND_EMAIL' ? 'email. No message was delivered.' : 'refund.'}`);
        }
      }
    });
  }

  function review(decision) {
    run(async () => {
      const needsPreview = record?.action === 'SANDBOX_FILE' && ['CHANGE', 'DELETE'].includes(record.arguments.operation);
      const reviewed = await reviewAction(requestId, decision, decision === 'APPROVE' && needsPreview ? filePreview?.fileSha256 : undefined);
      setQueueVersion(value => value + 1);
      setNotice(decision === 'APPROVE' ? reviewed.status === 'EXECUTED'
        ? 'Approved. SMTP server accepted the email; inbox delivery is not confirmed.' : 'Approval snapshot saved.' : 'Rejection saved.');
    });
  }

  function execute() {
    run(async () => {
      const body = { agentId: record.agentId, action: record.action, target: record.target, arguments: { ...record.arguments } };
      const completed = await executeAction(requestId, body);
      const result = completed.execution?.result;
      if (completed.status !== 'EXECUTED' || !(result?.simulated === true || result?.tool === 'SANDBOX_FILE' || (result?.transport === 'SMTP' && result.deliveryStatus === 'ACCEPTED'))) throw new Error('Invalid execution response; refresh the saved request.');
      setNotice(result.tool === 'SANDBOX_FILE' ? 'The real sandbox file operation completed.' : result.simulated ? 'Backend verified the authorized details and recorded a simulated execution.' : 'SMTP server accepted the email. Inbox delivery is not confirmed.');
    });
  }

  async function copyRequestId() {
    try { await navigator.clipboard.writeText(requestId); setNotice('Request ID copied.'); }
    catch { setError('Copy the request ID manually.'); }
  }

  const canExecute = record && !record.execution && ['AUTHORIZED', 'APPROVED'].includes(record.status);
  const policy = record?.policyDecision;
  const receipt = record?.execution?.result;
  const domain = domains.find(item => item.action === actionType);
  return <ThemeProvider theme={theme}><CssBaseline />
    <Box component="main" sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 3 }}>
        <Box><Typography variant="h4">AgentShield</Typography><Typography color="text.secondary">Review and control agent-requested refunds, emails, and sandbox file operations.</Typography></Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: '100%' }}><Chip label={`${user.email} · ${user.role}`} variant="outlined" sx={{ minWidth: 0 }} /><Button sx={{ flexShrink: 0 }} disabled={busy || policyBusy} onClick={() => run(async () => { select(''); await onLogout(); })}>Log out</Button></Stack>
      </Stack>
      <DomainSelector value={actionType} onChange={changeDomain} disabled={busy || policyBusy} realEmail={emailDelivery?.mode === 'SMTP'} />
      <Box sx={{ mb: 3, pl: 2, borderLeft: `4px solid ${domain.color}` }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{domain.title} demonstration</Typography>
        <Typography color="text.secondary">{isReviewer ? 'Select a request in this domain to review its policy, approve or reject it, and inspect execution.' : 'Choose an agent, submit an action, and follow its policy decision, approval, execution, and audit trail.'}</Typography>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {syncError && <Alert severity="warning" sx={{ mb: 2 }}>{syncError}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      {isReviewer && <Box sx={{ mb: 3 }}><Section title={`Customize ${actionType === 'REFUND' ? 'refund' : actionType === 'SEND_EMAIL' ? 'email' : 'sandbox'} policy`}>
        {actionType === 'REFUND' ? <PolicySettings disabled={busy} onBusyChange={setPolicyBusy} />
          : actionType === 'SEND_EMAIL' ? <EmailPolicySettings disabled={busy} onBusyChange={setPolicyBusy} />
            : <SandboxPolicySettings disabled={busy} onBusyChange={setPolicyBusy} />}
      </Section></Box>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {isReviewer ? <Section title={`Pending ${domain.requestLabel} requests`}>
          <PendingRequests actionType={actionType} disabled={busy} selectedId={requestId} refreshVersion={queueVersion} onSelect={id => { setError(''); setNotice(''); select(id); }} />
        </Section> : <Section title={`New ${domain.requestLabel} request`}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{domain.description}</Typography>
          {actionType === 'SEND_EMAIL' && <Alert severity={emailDelivery?.ready ? emailDelivery.mode === 'SMTP' ? 'warning' : 'info' : 'error'} sx={{ mb: 2 }}>
            {!emailDelivery ? deliveryError || 'Loading email delivery settings...' : !emailDelivery.ready ? 'Email delivery is not configured. Complete backend/.env and restart the backend.'
              : emailDelivery.mode === 'SMTP' ? `Real email from ${emailDelivery.from}. Any valid external address can be requested. Manager approval sends it immediately; blocked domains remain blocked. Policy-allowed recipients use Send Real Email.` : 'Simulation mode. No message will be sent.'}
          </Alert>}
          <AgentPicker key={actionType} tool={actionType} disabled={busy} onSelect={setSelectedAgent} />
          {actionType === 'SEND_EMAIL' ? <EmailFields value={email} onChange={setEmail} disabled={busy} realDelivery={emailDelivery?.mode === 'SMTP'} allowedRecipients={emailDelivery?.allowedRecipients || []} /> : actionType === 'SANDBOX_FILE' ? <SandboxFields value={sandbox} onChange={setSandbox} disabled={busy} /> : <><Row label="Target" value="Customer-123" /><TextField label="Refund amount (INR)" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} type="number" fullWidth sx={{ my: 2 }} /><Typography variant="caption" color="text.secondary">Demo amounts for the default policy (custom limits may differ)</Typography><Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1, mb: 2 }}>{[['2000', 'Allow · Rs. 2,000'], ['8000', 'Review · Rs. 8,000'], ['25000', 'Block · Rs. 25,000']].map(([value, label]) => <Button key={value} size="small" variant="outlined" disabled={busy} onClick={() => setAmount(value)}>{label}</Button>)}</Stack></>}
          <Stack direction="row" spacing={1}><Button variant="contained" disabled={busy || !selectedAgent || (actionType === 'REFUND' ? !Number.isFinite(Number(amount)) || Number(amount) <= 0 : actionType === 'SANDBOX_FILE' ? !sandbox.path : !emailDelivery?.ready || !email.recipient.trim() || !email.subject.trim() || !email.body.trim())} onClick={submit}>{busy ? 'Working...' : 'Submit Request'}</Button>
            <Button disabled={busy} onClick={() => { select(''); setError(''); setNotice(''); }}>Reset Demo</Button></Stack>
          <TextField label="Saved request ID" value={lookup} disabled={busy} onChange={e => setLookup(e.target.value)} fullWidth sx={{ mt: 3, mb: 1 }} />
          <Button disabled={busy || !lookup.trim()} onClick={() => { setError(''); setNotice(''); select(lookup.trim()); }}>Load saved request</Button>
        </Section>}
        <Section title="Policy and saved status">
          {!record ? <Typography>{requestId ? 'Loading saved request...' : isReviewer ? 'Select a pending request to review.' : 'Submit or load a request.'}</Typography> : <>
            <Row label="Request ID" value={requestId} /><Row label="Request agent" value={record.agentId} /><Row label="Current status" value={record.status} />
            <Button disabled={busy} onClick={copyRequestId}>Copy request ID</Button>
            <Row label="Action scope" value={record.action} /><Row label="Policy decision" value={policy.decision} /><Row label="Policy version" value={policy.policyVersion} />
            <ActionDetails action={record} />
            {isReviewer && record.action === 'SANDBOX_FILE' && record.status === 'PENDING_APPROVAL'
              && ['CHANGE', 'DELETE'].includes(record.arguments.operation) && <Box sx={{ mt: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>Current file contents before approval</Typography>
                {filePreview ? <Box component="pre" sx={{ p: 2, border: '1px solid', borderColor: 'divider', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflowY: 'auto' }}>{filePreview.content || '(empty file)'}</Box>
                  : <Alert severity="warning">{filePreviewError || 'Loading file preview...'}</Alert>}
                <Button disabled={busy} onClick={refreshFilePreview}>Refresh file preview</Button>
              </Box>}
            {record.action === 'REFUND' ? <><Row label="Auto-approve limit" value={money(policy.policy.autoApproveLimit)} /><Row label="Maximum refund" value={money(policy.policy.maxAllowedRefund)} /></> : record.action === 'SANDBOX_FILE' ? <>
              <Row label="Allowed paths" value={policy.policy.allowedPaths?.join(', ') || policy.policy.allowedRoot || 'None'} />
              <Row label="Protected paths" value={policy.policy.protectedPaths?.join(', ') || policy.policy.protectedRoot || 'None'} />
              <Row label="Operation decisions" value={policy.policy.operationActions ? Object.entries(policy.policy.operationActions).map(([operation, decision]) => `${operation}: ${decision}`).join(' · ') : `Approval required: ${policy.policy.approvalOperations?.join(', ') || 'None'}`} />
              <Row label="Maximum content" value={policy.policy.maxContentBytes ? `${policy.policy.maxContentBytes} UTF-8 bytes` : '8,000 UTF-8 bytes'} />
            </> : <><Row label="Internal domains" value={policy.policy.internalDomains.join(', ') || 'None'} /><Row label="Blocked domains" value={policy.policy.blockedDomains.join(', ') || 'None'} /><Row label="Other domains" value={policy.policy.externalAction || 'REQUIRE_APPROVAL'} /></>}
            <Typography color="text.secondary" sx={{ mt: 2 }}>{policy.reason}</Typography>
          </>}
        </Section>
      </Box>
      <Box sx={{ mt: 3 }}><Section title="Approval and execution">
        {!record ? <Typography>No saved request selected.</Typography> : <Stack spacing={2}>
          {record.approval && <Box><Row label="Review ID" value={record.approval.id} /><Row label="Saved decision" value={record.approval.decision} /><Typography sx={{ my: 1 }}>Reviewed action snapshot</Typography><ActionDetails action={record.approval.snapshot} /></Box>}
          {record.approval?.reviewer && <Row label="Reviewed by" value={record.approval.reviewer.email} />}
          {record.status === 'PENDING_APPROVAL' && (user.role === 'USER' ? <Alert severity="info">Waiting for a Manager or Admin to review this request.</Alert> : <Stack direction="row" spacing={1}><Button variant="contained" disabled={busy || (record.action === 'SANDBOX_FILE' && ['CHANGE', 'DELETE'].includes(record.arguments.operation) && !filePreview)} onClick={() => review('APPROVE')}>Approve</Button><Button variant="outlined" color="error" disabled={busy} onClick={() => review('REJECT')}>Reject</Button></Stack>)}
          {['BLOCKED', 'REJECTED'].includes(record.status) && <Alert severity="error">This request cannot execute.</Alert>}
          {canExecute && <Button variant="contained" disabled={busy} onClick={execute}>{record.action === 'SEND_EMAIL' ? record.executionMode === 'SMTP' ? 'Send Real Email' : 'Execute Email Simulation' : record.action === 'SANDBOX_FILE' ? 'Execute File Operation' : 'Execute Approved Refund'}</Button>}
          {receipt && <Box><ExecutionReceipt record={record} /><Button color="error" disabled={busy} onClick={() => execute()}>Test Replay Protection</Button></Box>}
        </Stack>}
      </Section></Box>
      <Box sx={{ mt: 3 }}><Section title="Saved audit log">
        <TableContainer><Table size="small"><TableHead><TableRow>{['Time', 'Event', 'Status', 'Reason'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
          <TableBody>{audit.length === 0 ? <TableRow><TableCell colSpan={4}>No saved events loaded.</TableCell></TableRow> : audit.map(entry => <TableRow key={entry.id}><TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell><TableCell>{entry.event}</TableCell><TableCell>{entry.status}</TableCell><TableCell>{entry.reason}</TableCell></TableRow>)}</TableBody>
        </Table></TableContainer>
      </Section></Box>
    </Box>
  </ThemeProvider>;
}
