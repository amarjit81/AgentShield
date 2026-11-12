import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { clearSession, currentSession, login, logout } from '../services/auth';

const evaluationEmail = 'user@agentshield.test';
const evaluationPassword = 'AgentShieldDemo!2026';

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const retryTimer = useRef();
  const restoreVersion = useRef(0);

  async function restore() {
    const version = ++restoreVersion.current;
    clearTimeout(retryTimer.current);
    setLoading(true);
    setError('');
    try {
      const restored = await currentSession();
      if (version !== restoreVersion.current) return;
      setSession(restored); setLoading(false);
    }
    catch (err) {
      if (version !== restoreVersion.current) return;
      if (err.status === 401) { setSession(null); setLoading(false); }
      else if (err.status === 503 || err instanceof TypeError) {
        setError('The local service is temporarily unavailable. Retrying your session automatically.');
        retryTimer.current = setTimeout(restore, 5000);
      } else { setError(err.message); setLoading(false); }
    }
  }
  useEffect(() => {
    restore();
    const expired = () => { ++restoreVersion.current; clearTimeout(retryTimer.current); clearSession(); setSession(null); setLoading(false); setError('Your session has ended. Please log in again.'); };
    window.addEventListener('agentshield-session-ended', expired);
    return () => { ++restoreVersion.current; clearTimeout(retryTimer.current); window.removeEventListener('agentshield-session-ended', expired); };
  }, []);

  async function authenticate(loginEmail, loginPassword) {
    if (busy) return;
    setBusy(true); setError('');
    try { setSession(await login(loginEmail, loginPassword)); setPassword(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function signIn(event) {
    event.preventDefault();
    await authenticate(email, password);
  }
  async function signInForEvaluation() {
    setEmail(evaluationEmail);
    setPassword(evaluationPassword);
    await authenticate(evaluationEmail, evaluationPassword);
  }
  async function signOut() {
    try { await logout(); setSession(null); setPassword(''); setError(''); }
    catch (err) {
      if (err.status === 401) { clearSession(); setSession(null); }
      else throw err;
    }
  }

  if (loading) return <Box sx={{ p: 4 }}><Typography>Checking your session...</Typography>{error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}</Box>;
  if (session) return children(session.user, signOut);
  return <Box sx={{ maxWidth: 440, mx: 'auto', p: 3, mt: 6 }}><Paper variant="outlined" sx={{ p: 3 }}>
    <Typography variant="h4" sx={{ mb: 1 }}>AgentShield</Typography>
    <Typography sx={{ mb: 3 }}>Log in to demonstrate refunds, emails, and sandbox file operations.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Alert severity="info" sx={{ mb: 2 }}>
      <Typography fontWeight={700}>Evaluation demo</Typography>
      <Typography variant="body2">Email: {evaluationEmail}</Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>Password: {evaluationPassword}</Typography>
      <Button size="small" variant="outlined" disabled={busy} onClick={signInForEvaluation}>
        {busy ? 'Opening demo...' : 'Enter evaluation demo'}
      </Button>
    </Alert>
    <Stack component="form" onSubmit={signIn} spacing={2}>
      <TextField label="Email" type="email" autoComplete="username" required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</Button>
      <Button disabled={busy} onClick={restore}>Check existing session</Button>
    </Stack>
  </Paper></Box>;
}
