import { useEffect, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { getPolicySettings, savePolicySettings } from '../services/policySettings';

export default function PolicySettings({ disabled, onBusyChange }) {
  const [policy, setPolicy] = useState(null);
  const [autoLimit, setAutoLimit] = useState('');
  const [maximum, setMaximum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  function apply(value) { setPolicy(value); setAutoLimit(String(value.autoApproveLimit)); setMaximum(String(value.maxAllowedRefund)); }
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null); setError(''); setNotice('');
    getPolicySettings(controller.signal).then(value => { if (!controller.signal.aborted) apply(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [revision]);
  const auto = Number(autoLimit), max = Number(maximum);
  const valid = autoLimit.trim() !== '' && maximum.trim() !== '' && Number.isInteger(auto) && Number.isInteger(max) && auto >= 0 && max > 0 && auto <= max && max <= 1000000000;
  async function save() {
    if (busy || disabled || !policy || !valid) return;
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try {
      apply(await savePolicySettings({ autoApproveLimit: auto, maxAllowedRefund: max, version: policy.version }));
      setNotice('Policy saved. These limits apply to new requests; existing requests keep their original policy.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <Stack spacing={2}>
    <Typography color="text.secondary">Set the rules for new refund requests. Requests up to the auto-approve limit are allowed automatically; requests up to the maximum require review; higher amounts are blocked.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {notice && <Alert severity="success">{notice}</Alert>}
    {!policy && !error && <Typography>Loading refund policy...</Typography>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField label="Auto-approve limit (INR)" type="number" value={autoLimit} disabled={disabled || busy || !policy} onChange={event => setAutoLimit(event.target.value)} fullWidth />
      <TextField label="Maximum refund (INR)" type="number" value={maximum} disabled={disabled || busy || !policy} onChange={event => setMaximum(event.target.value)} fullWidth />
    </Stack>
    {policy && !valid && <Alert severity="warning">Use whole rupees. The maximum must be positive, at least the auto-approve limit, and no more than 1,000,000,000.</Alert>}
    {policy && <Typography variant="body2">Policy version: {policy.version}{policy.updatedByEmail ? ` · Last saved by ${policy.updatedByEmail}` : ' · Default limits'}</Typography>}
    <Stack direction="row" spacing={1}><Button variant="contained" disabled={disabled || busy || !policy || !valid} onClick={save}>{busy ? 'Saving...' : 'Save policy'}</Button><Button disabled={disabled || busy} onClick={() => setRevision(value => value + 1)}>Reload policy</Button></Stack>
  </Stack>;
}
