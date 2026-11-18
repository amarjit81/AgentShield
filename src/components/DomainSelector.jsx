import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import { LayoutGroup, motion } from 'motion/react';
import { DomainGlyph } from './DomainArtwork';
import { useInterfaceMotion } from './InterfaceMotion';

export const domains = [
  { action: 'REFUND', title: 'Refunds', requestLabel: 'refund', number: '01', color: '#245e50', description: 'Control refund amounts and review requests against your limits.', mode: 'Simulated refunds' },
  { action: 'SEND_EMAIL', title: 'Email', requestLabel: 'email', number: '02', color: '#355caa', description: 'Review recipients and message content before an email can send.', mode: 'Email simulation' },
  { action: 'SANDBOX_FILE', title: 'Sandbox Files', requestLabel: 'sandbox file', number: '03', color: '#7851a1', description: 'Demonstrate read, write, and delete rules inside a safe workspace.', mode: 'Real demo files' },
];

export default function DomainSelector({ value, onChange, disabled, realEmail }) {
  const { enabled } = useInterfaceMotion();
  return <Box component="nav" aria-label="Action domains" sx={{ mb: 3 }}>
    <Typography variant="overline" color="text.secondary">Choose your action space</Typography>
    <LayoutGroup id="action-domains"><Box className="domain-rail" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 0, mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {domains.map(domain => {
        const selected = value === domain.action;
        return <ButtonBase key={domain.action} className={`domain-choice${selected ? ' is-selected' : ''}`} disabled={disabled} onClick={() => onChange(domain.action)}
          aria-pressed={selected} aria-label={`${domain.title} domain`}
          sx={{ p: 2.5, borderRadius: 0, textAlign: 'left', alignItems: 'stretch', border: '1px solid transparent',
            bgcolor: 'transparent', position: 'relative',
            '&.Mui-focusVisible': { outline: '3px solid #9271b4', outlineOffset: -4 },
            '&.Mui-disabled': { opacity: .6 } }}>
          {selected && <motion.span className="domain-selection" layoutId={enabled ? 'domain-selection' : undefined} transition={{ type: 'spring', stiffness: 350, damping: 34 }} />}
          <Stack spacing={1.5} sx={{ width: '100%', position: 'relative', zIndex: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '.75rem' }}>{domain.number} /</Typography>
              <span className="domain-mini-art"><DomainGlyph action={domain.action} /></span>
            </Stack>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>{domain.title} <span className="domain-arrow" aria-hidden="true">↗</span></Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>{domain.description}</Typography>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}><Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>{domain.action === 'SEND_EMAIL' && realEmail ? 'Real email · Manager approval sends' : domain.mode}</Typography><Chip size="small" label={selected ? 'Selected' : 'Explore'} variant="outlined" /></Stack>
          </Stack>
        </ButtonBase>;
      })}
    </Box></LayoutGroup>
  </Box>;
}
