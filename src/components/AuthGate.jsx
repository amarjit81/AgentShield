import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { clearSession, currentSession, login, logout } from '../services/auth';
import Brand from './Brand';
import { useInterfaceMotion } from './InterfaceMotion';

const evaluationEmail = 'user@agentshield.test';
const evaluationPassword = 'AgentShieldDemo!2026';

export default function AuthGate({ children }) {
  const { enabled, reduced, toggle } = useInterfaceMotion();
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

  if (loading) return <div className="session-loading"><Brand /><p role="status">Opening your workspace…</p>{error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}</div>;
  if (session) return children(session.user, signOut);
  return <div className="login-page">
    <header className="login-header"><Brand /><span className="eyebrow">A HUMAN SAY IN EVERY AGENT ACTION.</span><a href="#sign-in">Your workspace <span aria-hidden="true">↗</span></a></header>
    <main className="login-layout">
      <section className="login-story" aria-labelledby="brand-headline"><span className="eyebrow">BUILT FOR AGENTS. GUIDED BY YOU.</span><h1 id="brand-headline">Power,<br />with <em>permission.</em><span className="headline-dot">*</span></h1><p>Let your agents do more.<br />Keep the final say.</p>
        <div className="permission-art" aria-label="Illustration of an agent action passing through a policy boundary"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><span>as.</span></div><span className="art-label label-action">01 / AGENT INTENT</span><span className="art-label label-human">02 / YOUR RULES</span><span className="art-label label-proof">03 / ACCOUNTABLE ACTION</span><span className="art-node node-one">↗</span><span className="art-node node-two">✓</span></div>
        <div className="story-footnote"><span>REFUNDS / EMAIL / SANDBOX FILES</span>{!reduced && <button type="button" className="orbit-toggle" onClick={toggle}>{enabled ? 'Pause animation' : 'Play animation'}</button>}</div>
      </section>
      <section className="login-form-area" id="sign-in" aria-labelledby="login-title"><Paper className="login-panel" elevation={0}>
    <span className="eyebrow">YOUR CONTROL ROOM</span>
    <Typography component="h2" id="login-title" className="login-title">Good to have<br />you here.</Typography>
    <Typography sx={{ mb: 4 }} color="text.secondary">Sign in to your AgentShield workspace.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Stack component="form" onSubmit={signIn} spacing={2}>
      <TextField label="Email" type="email" autoComplete="username" required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <Button type="submit" variant="contained" className="login-submit" disabled={busy}>{busy ? 'Opening workspace…' : 'Enter workspace ↗'}</Button>
      <Button size="small" disabled={busy} onClick={restore}>Restore existing session</Button>
    </Stack>
    <div className="evaluation-box"><span className="eyebrow">JUST EXPLORING?</span><Typography variant="body2" sx={{ my: 1 }}>Take the user workspace for a spin with the classroom demo.</Typography><Button variant="outlined" fullWidth disabled={busy} onClick={signInForEvaluation}>{busy ? 'Opening demo…' : 'Try the evaluation demo ↗'}</Button><details><summary>Demo sign-in details</summary><p>{evaluationEmail}<br />{evaluationPassword}</p></details></div>
    <p className="login-access-note">Your account role opens the right workspace.<br />Users request. Managers review.</p>
  </Paper></section></main><footer className="login-footer"><span>AGENTSHIELD / AGENT GOVERNANCE</span><span>Human judgment. Agent potential.</span></footer></div>;
}
