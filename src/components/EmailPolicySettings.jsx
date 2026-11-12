import { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { getEmailPolicySettings, saveEmailPolicySettings } from '../services/policySettings';

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;
const lines = value => value.split(/\r?\n/).map(item => item.trim().toLowerCase()).filter(Boolean);

export default function EmailPolicySettings({ disabled, onBusyChange }) {
  const [policy, setPolicy] = useState(null);
  const [internal, setInternal] = useState('');
  const [blocked, setBlocked] = useState('');
  const [externalAction, setExternalAction] = useState('REQUIRE_APPROVAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  function apply(value) {
    setPolicy(value); setInternal(value.internalDomains.join('\n')); setBlocked(value.blockedDomains.join('\n'));
    setExternalAction(value.externalAction);
  }
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null); setError(''); setNotice('');
    getEmailPolicySettings(controller.signal).then(value => { if (!controller.signal.aborted) apply(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [revision]);
  const internalDomains = lines(internal), blockedDomains = lines(blocked);
  const domains = [...internalDomains, ...blockedDomains];
  const valid = internalDomains.length <= 100 && blockedDomains.length <= 100
    && domains.every(value => domainPattern.test(value))
    && new Set(internalDomains).size === internalDomains.length && new Set(blockedDomains).size === blockedDomains.length;
  async function save() {
    if (busy || disabled || !policy || !valid) return;
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try {
      apply(await saveEmailPolicySettings({ internalDomains, blockedDomains, externalAction, version: policy.version }));
      setNotice('Email policy saved. It applies to new requests; existing requests keep their original snapshot.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <Stack spacing={2}>
    <Typography color="text.secondary">Internal domains are allowed automatically. Blocked domains always win. Choose whether every other domain requires review or is blocked.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {notice && <Alert severity="success">{notice}</Alert>}
    {!policy && !error && <Typography>Loading email policy...</Typography>}
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <TextField label="Internal domains" value={internal} multiline minRows={3} fullWidth disabled={disabled || busy || !policy}
        helperText="One exact domain per line; subdomains inherit the rule." onChange={event => setInternal(event.target.value)} />
      <TextField label="Blocked domains" value={blocked} multiline minRows={3} fullWidth disabled={disabled || busy || !policy}
        helperText="One exact domain per line; blocked rules take precedence." onChange={event => setBlocked(event.target.value)} />
    </Stack>
    <TextField select label="All other domains" value={externalAction} disabled={disabled || busy || !policy}
      onChange={event => setExternalAction(event.target.value)}>
      <MenuItem value="REQUIRE_APPROVAL">Require Manager/Admin approval</MenuItem>
      <MenuItem value="BLOCK">Block</MenuItem>
    </TextField>
    {policy && !valid && <Alert severity="warning">Use unique domains such as example.com, one per line, with no wildcards or URLs.</Alert>}
    {policy && <Typography variant="body2">Policy version: {policy.version}{policy.updatedByEmail ? ` · Last saved by ${policy.updatedByEmail}` : ' · Default settings'}</Typography>}
    <Stack direction="row" spacing={1}><Button variant="contained" disabled={disabled || busy || !policy || !valid} onClick={save}>{busy ? 'Saving...' : 'Save policy'}</Button><Button disabled={disabled || busy} onClick={() => setRevision(value => value + 1)}>Reload policy</Button></Stack>
  </Stack>;
}
