export default function Brand({ light = false }) {
  return <span className={`brand${light ? ' brand-light' : ''}`}>
    <svg width="34" height="38" viewBox="0 0 34 38" fill="none" aria-hidden="true"><path d="M17 2 31 7v11c0 8-6 14-14 18C9 32 3 26 3 18V7L17 2Z" stroke="currentColor" strokeWidth="2"/><path d="m10 22 7-12 7 12M13 18h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <span>AgentShield<span className="brand-period">.</span></span>
  </span>;
}
