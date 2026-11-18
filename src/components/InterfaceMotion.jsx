import { createContext, useContext, useEffect, useState } from 'react';
import { MotionConfig, useAnimate } from 'motion/react';

const MotionContext = createContext({ enabled: true, reduced: false, toggle: () => {} });
export function InterfaceMotion({ children }) {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('agentshield-motion') !== 'off'; } catch { return true; }
  });
  function toggle() {
    setEnabled(previous => {
      const next = !previous;
      try { localStorage.setItem('agentshield-motion', next ? 'on' : 'off'); } catch { /* Optional preference. */ }
      return next;
    });
  }
  return <MotionContext.Provider value={{ enabled, reduced, toggle }}><MotionConfig reducedMotion={enabled && !reduced ? 'user' : 'always'} transition={{ type: 'spring', stiffness: 330, damping: 32 }}><div className={enabled && !reduced ? 'motion-enabled' : 'motion-disabled'}>{children}</div></MotionConfig></MotionContext.Provider>;
}
export function useInterfaceMotion() {
  const { enabled, reduced, toggle } = useContext(MotionContext);
  return { enabled: enabled && !reduced, preference: enabled, reduced, toggle };
}

// Animate the existing DOM instead of remounting forms, polling effects or focus.
export function SceneTransition({ scene, children }) {
  const [scope, animate] = useAnimate();
  const { enabled } = useInterfaceMotion();
  useEffect(() => {
    if (!enabled) { animate(scope.current, { opacity: 1, y: 0 }, { duration: 0 }); return; }
    const controls = animate(scope.current, { opacity: [.45, 1], y: [14, 0] }, { duration: .36, ease: [.22, 1, .36, 1] });
    return () => controls.stop();
  }, [scene, enabled, animate, scope]);
  return <div ref={scope} className="workspace-scene">{children}</div>;
}
