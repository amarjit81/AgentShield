import { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { getSandboxPolicySettings, saveSandboxPolicySettings } from '../services/policySettings';

const pathPattern = /^workspace\/(?:[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\/)*$/;
const lines = value => value.split(/\r?\n/).map(item => item.trim().toLowerCase()).filter(Boolean);
const operations = ['READ', 'WRITE', 'CHANGE', 'DELETE'];
const choices = [['ALLOW', 'Allow automatically'], ['REQUIRE_APPROVAL', 'Require Manager/Admin approval'], ['BLOCK', 'Block']];

export default function SandboxPolicySettings({ disabled, onBusyChange }) {
  const [policy, setPolicy] = useState(null);
  const [allowed, setAllowed] = useState('');
  const [protectedPathsText, setProtectedPathsText] = useState('');
  const [actions, setActions] = useState({ READ: 'ALLOW', WRITE: 'ALLOW', CHANGE: 'REQUIRE_APPROVAL', DELETE: 'REQUIRE_APPROVAL' });
  const [maximum, setMaximum] = useState('8000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  function apply(value) {
    setPolicy(value); setAllowed(value.allowedPaths.join('\n')); setProtectedPathsText(value.protectedPaths.join('\n'));
    setActions(value.operationActions); setMaximum(String(value.maxContentBytes));
  }
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null); setError(''); setNotice('');
    getSandboxPolicySettings(controller.signal).then(value => { if (!controller.signal.aborted) apply(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [revision]);
  const allowedPaths = lines(allowed), protectedPaths = lines(protectedPathsText), maxContentBytes = Number(maximum);
  const valid = allowedPaths.length > 0 && allowedPaths.length <= 100 && protectedPaths.length <= 100
    && [...allowedPaths, ...protectedPaths].every(value => pathPattern.test(value))
    && new Set(allowedPaths).size === allowedPaths.length && new Set(protectedPaths).size === protectedPaths.length
    && Number.isInteger(maxContentBytes) && maxContentBytes >= 1 && maxContentBytes <= 8000;
  async function save() {
    if (busy || disabled || !policy || !valid) return;
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try {
      apply(await saveSandboxPolicySettings({ allowedPaths, protectedPaths, operationActions: actions, maxContentBytes, version: policy.version }));
      setNotice('Sandbox policy saved. It applies to new requests; existing requests keep their original snapshot.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <Stack spacing={2}>
    <Alert severity="info">The permanent workspace/ boundary and workspace/protected/ block cannot be bypassed. These settings can only narrow access or change decisions inside that boundary.</Alert>
    {error && <Alert severity="error">{error}</Alert>}
    {notice && <Alert severity="success">{notice}</Alert>}
    {!policy && !error && <Typography>Loading sandbox policy...</Typography>}
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <TextField label="Allowed folder prefixes" value={allowed} multiline minRows={3} fullWidth disabled={disabled || busy || !policy}
        helperText="One workspace/ folder prefix per line; include the trailing slash." onChange={event => setAllowed(event.target.value)} />
      <TextField label="Additional protected prefixes" value={protectedPathsText} multiline minRows={3} fullWidth disabled={disabled || busy || !policy}
        helperText="These paths are blocked even when also allowed." onChange={event => setProtectedPathsText(event.target.value)} />
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
      {operations.map(operation => <TextField key={operation} select label={`${operation} decision`} value={actions[operation]}
        disabled={disabled || busy || !policy} sx={{ minWidth: 230, flex: 1 }}
        onChange={event => setActions(current => ({ ...current, [operation]: event.target.value }))}>
        {choices.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>)}
    </Stack>
    <TextField label="Maximum WRITE/CHANGE content (UTF-8 bytes)" type="number" value={maximum}
      disabled={disabled || busy || !policy} onChange={event => setMaximum(event.target.value)} />
    {policy && !valid && <Alert severity="warning">Use unique workspace/ folder prefixes with trailing slashes and a content limit from 1 to 8,000 bytes.</Alert>}
    {policy && <Typography variant="body2">Policy version: {policy.version}{policy.updatedByEmail ? ` · Last saved by ${policy.updatedByEmail}` : ' · Default settings'}</Typography>}
    <Stack direction="row" spacing={1}><Button variant="contained" disabled={disabled || busy || !policy || !valid} onClick={save}>{busy ? 'Saving...' : 'Save policy'}</Button><Button disabled={disabled || busy} onClick={() => setRevision(value => value + 1)}>Reload policy</Button></Stack>
  </Stack>;
}
