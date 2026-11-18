import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';
import { useInterfaceMotion } from './InterfaceMotion';

const drawings = {
  REFUND: ['M35 19h50v82l-6-4-6 4-6-4-7 4-7-4-6 4-6-4-6 4V19Z', 'M46 36h28M46 47h19M46 58h28', 'm49 77 7 7 14-15'],
  SEND_EMAIL: ['M23 33h74v54H23Z', 'm24 34 36 28 36-28', 'm24 86 24-25m48 25L72 61', 'M14 47H3m11 12H7m7 12H3'],
  SANDBOX_FILE: ['m60 19 37 20v43L60 103 23 82V39Z', 'm23 39 37 21 37-21M60 60v43', 'm42 29 36 21v18', 'm44 74-7-4m7 12-7-4'],
};
export function DomainGlyph({ action, active = true }) {
  const { enabled } = useInterfaceMotion();
  return <svg viewBox="0 0 120 120" fill="none" aria-hidden="true" className="domain-glyph">
    {drawings[action].map((d, index) => <motion.path key={`${action}-${index}`} d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      initial={enabled ? { pathLength: 0, opacity: 0 } : false} animate={{ pathLength: 1, opacity: active ? 1 : .55 }} transition={{ duration: enabled ? .65 : 0, delay: enabled ? index * .07 : 0, ease: 'easeInOut' }} />)}
  </svg>;
}

export default function DomainArtwork({ domain }) {
  const { enabled } = useInterfaceMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const rotateX = useSpring(y, { stiffness: 110, damping: 18 });
  const rotateY = useSpring(x, { stiffness: 110, damping: 18 });
  function follow(event) {
    if (!enabled || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set(((event.clientX - bounds.left) / bounds.width - .5) * 12);
    y.set(-((event.clientY - bounds.top) / bounds.height - .5) * 12);
  }
  return <div className="domain-artwork" onPointerMove={follow} onPointerLeave={() => { x.set(0); y.set(0); }}>
    <motion.div className="artwork-plate" style={enabled ? { rotateX, rotateY } : {}}>
      <div className="artwork-coordinate"><span>AS / {domain.number}</span><span>↗</span></div>
      <AnimatePresence mode="wait" initial={false}><motion.div key={domain.action} className="artwork-drawing" initial={enabled ? { opacity: 0, scale: .8, rotate: -12 } : false} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: enabled ? .9 : 1 }} transition={{ duration: enabled ? .22 : 0 }}><DomainGlyph action={domain.action} /></motion.div></AnimatePresence>
      <div className="artwork-baseline"><span>INTENT</span><span className="artwork-track" /><span>PERMISSION</span></div>
    </motion.div>
    <AnimatePresence mode="wait" initial={false}><motion.span key={domain.action} className="artwork-caption" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: enabled ? .15 : 0 }}>{domain.title} / your rules, in motion.</motion.span></AnimatePresence>
  </div>;
}
