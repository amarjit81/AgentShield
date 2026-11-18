import { useEffect, useRef, useState } from 'react';

export const workspacePaths = { REFUND: 'refunds', SEND_EMAIL: 'email', SANDBOX_FILE: 'sandbox-files' };
export function readWorkspace() {
  return Object.entries(workspacePaths).find(([, path]) => location.hash === `#/domains/${path}`)?.[0] || null;
}
export default function useWorkspaceNavigation(locked, onDomainChange) {
  const [page, setPage] = useState(readWorkspace);
  const current = useRef(page);
  const config = useRef({ locked, onDomainChange });
  config.current = { locked, onDomainChange };
  const hash = action => action ? `#/domains/${workspacePaths[action]}` : '#/';
  function navigate(action, { replace = false, notify = true } = {}) {
    if (config.current.locked) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', hash(action));
    current.current = action;
    if (action && notify) config.current.onDomainChange(action);
    setPage(action);
  }
  useEffect(() => {
    const changed = () => {
      if (config.current.locked) { history.replaceState(null, '', hash(current.current)); return; }
      const action = readWorkspace();
      current.current = action;
      if (action) config.current.onDomainChange(action);
      setPage(action);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.getElementById('workspace-heading')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
  return { page, navigate };
}
