import { motion } from 'motion/react';
import { useInterfaceMotion } from './InterfaceMotion';

// A short decorative transition, never a loading gate or a tool invocation.
export default function DomainEntrance({ domain }) {
  const { enabled } = useInterfaceMotion();
  if (!enabled) return null;
  return <motion.div className={`domain-entrance entrance-${domain.action.toLowerCase()}`} aria-hidden="true"
    initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0], visibility: ['visible', 'visible', 'hidden'] }}
    transition={{ duration: 1.24, times: [0, .77, 1], ease: 'easeInOut' }}>
    <div className="entrance-object">
      {domain.action === 'REFUND' ? <div className="entrance-receipt"><span className="eyebrow">AGENTSHIELD / LEDGER</span><div className="receipt-rule"/><i/><i/><i/><div className="receipt-seal">✓</div></div>
        : domain.action === 'SEND_EMAIL' ? <div className="entrance-envelope"><div className="envelope-letter"><i/><i/><i/></div><div className="envelope-flap"/><div className="envelope-front"/></div>
          : <div className="entrance-folder"><div className="folder-tab"/><div className="folder-sheet"><i/><i/><i/></div><div className="folder-front"/></div>}
      <span className="entrance-label">{domain.title}</span>
    </div>
  </motion.div>;
}
