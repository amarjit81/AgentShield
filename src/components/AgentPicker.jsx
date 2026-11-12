import { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { getAgents } from '../services/agents';

export default function AgentPicker({ disabled, onSelect, tool = 'REFUND' }) {
  const [agents, setAgents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retry;
    setLoading(true); setError(''); setRetrying(false); onSelect(null);
    async function load() {
      try {
        const values = await getAgents(controller.signal);
        if (controller.signal.aborted) return;
        const matching = values.filter(agent => agent.allowedTools.includes(tool));
        setAgents(matching);
        setSelectedId(previous => matching.some(agent => agent.id === previous) ? previous
          : (matching.find(agent => agent.active)?.id || matching[0]?.id || ''));
        setError(''); setRetrying(false);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err.message); setAgents([]); setLoading(false);
        const temporary = err instanceof TypeError || err.status === 503;
        setRetrying(temporary);
        if (temporary) retry = setTimeout(load, 5000);
      }
    }
    load();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [revision, onSelect, tool]);

  const selected = agents.find(agent => agent.id === selectedId) || null;
  useEffect(() => { onSelect(loading || error ? null : selected); }, [selected, loading, error, onSelect]);

  return <Stack spacing={1}>
    <TextField select label="Registered agent" value={selected ? selectedId : ''} fullWidth disabled={disabled || loading || agents.length === 0}
      onChange={event => setSelectedId(event.target.value)}>
      {agents.map(agent => <MenuItem key={agent.id} value={agent.id}>{agent.name} ({agent.id}) — {agent.active ? 'active' : 'inactive'} — {agent.allowedTools.join(', ') || 'no permissions'}</MenuItem>)}
    </TextField>
    {error && <Alert severity="error">Unable to load agents: {error} {retrying ? 'Retrying automatically.' : 'Check the backend and database, then click Refresh agents.'}</Alert>}
    {loading ? <Typography color="text.secondary">Loading your agents...</Typography>
      : agents.length === 0 && !error ? <Alert severity="info">No agents with {tool} permission are registered for this account. Saved requests remain available.</Alert> : null}
    {selected && <Typography color="text.secondary">Status: {selected.active ? 'Active' : 'Inactive'} · Permissions: {selected.allowedTools.join(', ') || 'None'}</Typography>}
    {selected && (!selected.active || !selected.allowedTools.includes(tool)) && <Alert severity="warning">The backend will deny {tool} submissions for this agent.</Alert>}
    <Button disabled={disabled || loading} onClick={() => setRevision(value => value + 1)} sx={{ alignSelf: 'flex-start' }}>Refresh agents</Button>
  </Stack>;
}
