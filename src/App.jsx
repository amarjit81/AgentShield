import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CssBaseline, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import Brand from './components/Brand';
import { AnimatePresence, motion } from 'motion/react';
import { InterfaceMotion, SceneTransition, useInterfaceMotion } from './components/InterfaceMotion';
import DomainArtwork from './components/DomainArtwork';
import DomainEntrance from './components/DomainEntrance';
import useWorkspaceNavigation, { readWorkspace } from './components/useWorkspaceNavigation';
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

const money = value => `Rs. ${new Intl.NumberFormat('en-IN').format(value)}`;
const storageKey = 'agentshield-request-id';
function savedId(userId) { try { return localStorage.getItem(`${storageKey}:${userId}`) || ''; } catch { return ''; } }
function remember(id, userId) { try { if (id) localStorage.setItem(`${storageKey}:${userId}`, id); else localStorage.removeItem(`${storageKey}:${userId}`); } catch { /* Persistence is optional. */ } }
const MotionPaper = motion.create(Paper);
function Section({ title, children, className = '' }) {
  const { enabled } = useInterfaceMotion();
  return <MotionPaper component="section" className={`workspace-section ${className}`} variant="outlined" initial={enabled ? { opacity: 0, y: 18 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .08 }} transition={{ duration: .45, ease: [.22, 1, .36, 1] }} sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}><Typography component="h2" variant="h6" sx={{ mb: 2 }}>{title}</Typography>{children}</MotionPaper>;
}
const workspaceIntro = {
  REFUND: { user: 'Enter an amount and see how it compares with the refund limits.', manager: 'Check the amount and saved limits before deciding.' },
  SEND_EMAIL: { user: 'Compose a message and check how its recipient is handled.', manager: 'Inspect the recipient, message and delivery mode before deciding.' },
  SANDBOX_FILE: { user: 'Choose a file operation and follow its policy decision.', manager: 'Compare current and proposed content before approving a file change.' },
};
function Row({ label, value }) {
  return <Box className="detail-row" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1 }}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere', textAlign: 'right', minWidth: 0 }}>{value}</Typography></Box>;
}

export default function App() {
  return <ThemeProvider theme={theme}><CssBaseline /><InterfaceMotion><AuthGate>{(user, onLogout) => <Dashboard key={user.id} user={user} onLogout={onLogout} />}</AuthGate></InterfaceMotion></ThemeProvider>;
}

function Dashboard({ user, onLogout }) {
  const { enabled: motionEnabled, preference: motionPreference, reduced, toggle: toggleMotion } = useInterfaceMotion();
  const isReviewer = ['MANAGER', 'ADMIN'].includes(user.role);
  const [queueVersion, setQueueVersion] = useState(0);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [amount, setAmount] = useState('8000');
  const [actionType, setActionType] = useState(() => readWorkspace() || 'REFUND');
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
  const { page, navigate } = useWorkspaceNavigation(busy || policyBusy, changeDomain);

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
      if (page && page !== action.action) navigate(action.action, { replace: true, notify: false });
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
    <Box component="main" className="dashboard" sx={{ maxWidth: 1320, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 3 }}>
        <Brand /><Button className="motion-toggle" size="small" onClick={toggleMotion} aria-pressed={motionPreference} aria-label="Toggle interface animations">{reduced ? 'Reduced motion' : motionPreference ? 'Motion on' : 'Motion off'}<span aria-hidden="true" className={motionEnabled ? 'motion-switch is-on' : 'motion-switch'} /></Button>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: '100%' }}><Chip label={`${user.email} · ${user.role}`} variant="outlined" sx={{ minWidth: 0 }} /><Button sx={{ flexShrink: 0 }} disabled={busy || policyBusy} onClick={() => run(async () => { select(''); await onLogout(); })}>Log out</Button></Stack>
      </Stack>
      {!page ? <div className="domain-home">
        <div className="workspace-intro"><div><span className="eyebrow">{isReviewer ? 'MANAGER WORKSPACE' : 'USER WORKSPACE'} / AGENT GOVERNANCE</span><h1 id="workspace-heading" tabIndex={-1}>{isReviewer ? <>A little oversight.<br /><em>A lot of confidence.</em></> : <>Big possibilities.<br /><em>Clear boundaries.</em></>}</h1><p>Three action spaces. One clear boundary.<br />Choose a domain to {isReviewer ? 'review requests and shape its policy.' : 'put your agents to work.'}</p></div><div className="home-insignia" aria-hidden="true"><span>as.</span><small>POWER, WITH PERMISSION.</small></div></div>
        <DomainSelector value={null} onChange={action => navigate(action)} disabled={busy || policyBusy} realEmail={emailDelivery?.mode === 'SMTP'} />
        <div className="home-footnote"><span>01 / CHOOSE A DOMAIN</span><span>02 / {isReviewer ? 'REVIEW THE INTENT' : 'SUBMIT AN INTENT'}</span><span>03 / FOLLOW THE PROOF</span></div>
      </div> : <>
      <DomainEntrance key={page} domain={domain} />
      <div className="workspace-breadcrumb"><Button onClick={() => navigate(null)} disabled={busy || policyBusy}>← Back to dashboard</Button><span className="eyebrow">{isReviewer ? 'MANAGER' : 'USER'} / {domain.title}</span></div>
      <div className="workspace-intro domain-page-intro">
        <div><h1 id="workspace-heading" tabIndex={-1}>{domain.title} workspace</h1>
          <p>{workspaceIntro[actionType][isReviewer ? 'manager' : 'user']}</p>
        </div>
        <DomainArtwork domain={domain} />
      </div>
      <SceneTransition scene={actionType}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {syncError && <Alert severity="warning" sx={{ mb: 2 }}>{syncError}</Alert>}
      <AnimatePresence initial={false}>{notice && <motion.div key={notice} initial={{ opacity: 0, y: motionEnabled ? -8 : 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert></motion.div>}</AnimatePresence>
      <div className={`workspace-layout ${isReviewer ? 'review-layout' : 'compose-layout'}`}>
        {isReviewer ? <Section title="Review queue" className="workspace-primary">
          <PendingRequests actionType={actionType} disabled={busy} selectedId={requestId} refreshVersion={queueVersion} onSelect={id => { setError(''); setNotice(''); select(id); }} />
        </Section> : <Section title={`New ${domain.requestLabel} request`} className="workspace-primary">
          {actionType === 'SEND_EMAIL' && <Alert severity={emailDelivery?.ready ? emailDelivery.mode === 'SMTP' ? 'warning' : 'info' : 'error'} sx={{ mb: 2 }}>
            {!emailDelivery ? deliveryError || 'Loading email delivery settings...' : !emailDelivery.ready ? 'Email delivery is not configured. Complete backend/.env and restart the backend.'
              : emailDelivery.mode === 'SMTP' ? `Real email from ${emailDelivery.from}. Any valid external address can be requested. Manager approval sends it immediately; blocked domains remain blocked. Policy-allowed recipients use Send Real Email.` : 'Simulation mode. No message will be sent.'}
          </Alert>}
          <AgentPicker key={actionType} tool={actionType} disabled={busy} onSelect={setSelectedAgent} />
          {actionType === 'SEND_EMAIL' ? <EmailFields value={email} onChange={setEmail} disabled={busy} realDelivery={emailDelivery?.mode === 'SMTP'} allowedRecipients={emailDelivery?.allowedRecipients || []} /> : actionType === 'SANDBOX_FILE' ? <SandboxFields value={sandbox} onChange={setSandbox} disabled={busy} /> : <><Row label="Target" value="Customer-123" /><TextField label="Refund amount (INR)" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} type="number" fullWidth sx={{ my: 2 }} /><Typography variant="caption" color="text.secondary">Demo amounts for the default policy (custom limits may differ)</Typography><Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1, mb: 2 }}>{[['2000', 'Allow · Rs. 2,000'], ['8000', 'Review · Rs. 8,000'], ['25000', 'Block · Rs. 25,000']].map(([value, label]) => <Button key={value} size="small" variant="outlined" disabled={busy} onClick={() => setAmount(value)}>{label}</Button>)}</Stack></>}
          <Stack direction="row" spacing={1}><Button variant="contained" className={busy ? 'request-submit is-working' : 'request-submit'} disabled={busy || !selectedAgent || (actionType === 'REFUND' ? !Number.isFinite(Number(amount)) || Number(amount) <= 0 : actionType === 'SANDBOX_FILE' ? !sandbox.path : !emailDelivery?.ready || !email.recipient.trim() || !email.subject.trim() || !email.body.trim())} onClick={submit}>{busy ? 'Working...' : 'Submit Request'}</Button>
            <Button disabled={busy} onClick={() => { select(''); setError(''); setNotice(''); }}>Reset Demo</Button></Stack>
          <details className="workspace-disclosure saved-lookup">
            <summary>Load a saved request</summary>
            <div className="disclosure-body">
              <TextField label="Saved request ID" value={lookup} disabled={busy} onChange={e => setLookup(e.target.value)} fullWidth sx={{ mb: 1 }} />
              <Button disabled={busy || !lookup.trim()} onClick={() => { setError(''); setNotice(''); select(lookup.trim()); }}>Load saved request</Button>
            </div>
          </details>
        </Section>}
        <Section title={isReviewer ? 'Request review' : 'Request outcome'} className="workspace-outcome">
          {!record ? <div className="empty-state"><span className="empty-symbol" aria-hidden="true">↗</span><h3>{requestId ? 'Finding your request' : isReviewer ? 'Select a request' : 'No request yet'}</h3><p>{requestId ? 'Loading the saved policy decision and status…' : isReviewer ? 'Open a request from the queue to inspect it and make a decision.' : 'Submit a request or load a saved ID to see its policy decision and next step.'}</p></div> : <>
            <div className="request-progress" aria-label="Request progress">{['Submitted', 'Evaluated', 'Reviewed', 'Executed'].map((step, index) => { const complete = index < 2 || (index === 2 && record.approval) || (index === 3 && record.execution); return <span key={step} className={complete ? 'stage-complete' : ''}><motion.i className="stage-line" initial={false} animate={{ scaleX: complete ? 1 : 0 }} transition={{ duration: motionEnabled ? .5 : 0, delay: motionEnabled ? index * .07 : 0 }} />{String(index + 1).padStart(2, '0')}<strong>{step}</strong></span>; })}</div>
            <Row label="Current status" value={<motion.span className={`status-tag status-${record.status.toLowerCase()}`} key={`${record.requestId}-${record.status}`} initial={motionEnabled ? { opacity: 0, scale: .92 } : false} animate={{ opacity: 1, scale: 1 }}>{record.status}</motion.span>} />
            <div className="request-document">
              <ActionDetails action={record} currentFile={isReviewer && record.action === 'SANDBOX_FILE' && record.status === 'PENDING_APPROVAL'
                && ['CHANGE', 'DELETE'].includes(record.arguments.operation) ? { filePreview, filePreviewError, busy, refresh: refreshFilePreview } : undefined} />
            </div>
            <div className="decision-note"><strong>{policy.decision.replaceAll('_', ' ')}</strong><p>{policy.reason}</p></div>
            <Stack className="request-controls" spacing={2}>
              {record.status === 'PENDING_APPROVAL' && (user.role === 'USER' ? <Alert severity="info">Waiting for a Manager or Admin to review this request.</Alert> : <Stack direction="row" spacing={1}><Button variant="contained" disabled={busy || (record.action === 'SANDBOX_FILE' && ['CHANGE', 'DELETE'].includes(record.arguments.operation) && !filePreview)} onClick={() => review('APPROVE')}>Approve</Button><Button variant="outlined" color="error" disabled={busy} onClick={() => review('REJECT')}>Reject</Button></Stack>)}
              {['BLOCKED', 'REJECTED'].includes(record.status) && <Alert severity="error">This request cannot execute.</Alert>}
              {canExecute && <Button variant="contained" disabled={busy} onClick={execute}>{record.action === 'SEND_EMAIL' ? record.executionMode === 'SMTP' ? 'Send Real Email' : 'Execute Email Simulation' : record.action === 'SANDBOX_FILE' ? 'Execute File Operation' : 'Execute Approved Refund'}</Button>}
            </Stack>
            <details className="workspace-disclosure" key={record.requestId}>
              <summary>Saved policy and request details</summary>
              <div className="disclosure-body">
            <Row label="Request ID" value={requestId} /><Row label="Request agent" value={record.agentId} />
            <Button disabled={busy} onClick={copyRequestId}>Copy request ID</Button>
            <Row label="Action scope" value={record.action} /><Row label="Policy decision" value={policy.decision} /><Row label="Policy version" value={policy.policyVersion} />
            {record.action === 'REFUND' ? <><Row label="Auto-approve limit" value={money(policy.policy.autoApproveLimit)} /><Row label="Maximum refund" value={money(policy.policy.maxAllowedRefund)} /></> : record.action === 'SANDBOX_FILE' ? <>
              <Row label="Allowed paths" value={policy.policy.allowedPaths?.join(', ') || policy.policy.allowedRoot || 'None'} />
              <Row label="Protected paths" value={policy.policy.protectedPaths?.join(', ') || policy.policy.protectedRoot || 'None'} />
              <Row label="Operation decisions" value={policy.policy.operationActions ? Object.entries(policy.policy.operationActions).map(([operation, decision]) => `${operation}: ${decision}`).join(' · ') : `Approval required: ${policy.policy.approvalOperations?.join(', ') || 'None'}`} />
              <Row label="Maximum content" value={policy.policy.maxContentBytes ? `${policy.policy.maxContentBytes} UTF-8 bytes` : '8,000 UTF-8 bytes'} />
            </> : <><Row label="Internal domains" value={policy.policy.internalDomains.join(', ') || 'None'} /><Row label="Blocked domains" value={policy.policy.blockedDomains.join(', ') || 'None'} /><Row label="Other domains" value={policy.policy.externalAction || 'REQUIRE_APPROVAL'} /></>}
              </div>
            </details>
            <Stack spacing={2} className="request-receipts">
          {record.approval && <Box><Row label="Review ID" value={record.approval.id} /><Row label="Saved decision" value={record.approval.decision} /><Typography sx={{ my: 1 }}>Reviewed action snapshot</Typography><ActionDetails action={record.approval.snapshot} /></Box>}
          {record.approval?.reviewer && <Row label="Reviewed by" value={record.approval.reviewer.email} />}
          {receipt && <Box><ExecutionReceipt record={record} /><Button color="error" disabled={busy} onClick={() => execute()}>Test Replay Protection</Button></Box>}
            </Stack>
          </>}
        </Section>
      </div>
      {isReviewer && <details className="workspace-disclosure workspace-secondary" key={actionType}>
        <summary>{domain.title} policy settings</summary>
        <div className="disclosure-body">
          {actionType === 'REFUND' ? <PolicySettings disabled={busy} onBusyChange={setPolicyBusy} />
            : actionType === 'SEND_EMAIL' ? <EmailPolicySettings disabled={busy} onBusyChange={setPolicyBusy} />
              : <SandboxPolicySettings disabled={busy} onBusyChange={setPolicyBusy} />}
        </div>
      </details>}
      <details className="workspace-disclosure workspace-secondary">
        <summary>Saved audit log <span className="audit-count">{audit.length} {audit.length === 1 ? 'event' : 'events'}</span></summary>
        <div className="disclosure-body">
        <TableContainer><Table size="small"><TableHead><TableRow>{['Time', 'Event', 'Status', 'Reason'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
          <TableBody>{audit.length === 0 ? <TableRow><TableCell colSpan={4}>No saved events loaded.</TableCell></TableRow> : audit.map(entry => <TableRow key={entry.id}><TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell><TableCell>{entry.event}</TableCell><TableCell>{entry.status}</TableCell><TableCell>{entry.reason}</TableCell></TableRow>)}</TableBody>
        </Table></TableContainer>
        </div>
      </details>
      </SceneTransition>
      </>}
      <footer className="workspace-footer"><Brand /><span>Human judgment. Agent potential.</span><span>POWER, WITH PERMISSION.</span></footer>
    </Box>
  </ThemeProvider>;
}
