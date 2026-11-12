import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material';

export const domains = [
  { action: 'REFUND', title: 'Refunds', requestLabel: 'refund', number: '01', color: '#245e50', description: 'Control refund amounts and review requests against your limits.', mode: 'Simulated refunds' },
  { action: 'SEND_EMAIL', title: 'Email', requestLabel: 'email', number: '02', color: '#355caa', description: 'Review recipients and message content before an email can send.', mode: 'Email simulation' },
  { action: 'SANDBOX_FILE', title: 'Sandbox Files', requestLabel: 'sandbox file', number: '03', color: '#7851a1', description: 'Demonstrate read, write, and delete rules inside a safe workspace.', mode: 'Real demo files' },
];

export default function DomainSelector({ value, onChange, disabled, realEmail }) {
  return <Box component="nav" aria-label="Action domains" sx={{ mb: 3 }}>
    <Typography variant="overline" color="text.secondary">Choose a demonstration domain</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mt: 1 }}>
      {domains.map(domain => {
        const selected = value === domain.action;
        return <ButtonBase key={domain.action} disabled={disabled} onClick={() => onChange(domain.action)}
          aria-pressed={selected} aria-label={`${domain.title} domain`}
          sx={{ p: 2.5, borderRadius: 3, textAlign: 'left', alignItems: 'stretch', border: '2px solid',
            borderColor: selected ? domain.color : 'divider', bgcolor: selected ? `${domain.color}0c` : 'background.paper',
            '&:hover': { borderColor: domain.color }, '&.Mui-focusVisible': { outline: `3px solid ${domain.color}`, outlineOffset: 3 },
            '&.Mui-disabled': { opacity: .6 } }}>
          <Stack spacing={1.5} sx={{ width: '100%' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ color: domain.color, fontWeight: 700 }}>{domain.number}</Typography>
              <Chip size="small" label={selected ? 'Selected' : 'Select domain'} variant={selected ? 'filled' : 'outlined'} />
            </Stack>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{domain.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>{domain.description}</Typography>
            <Typography variant="caption" sx={{ color: domain.color, fontWeight: 600 }}>{domain.action === 'SEND_EMAIL' && realEmail ? 'Real email · Manager approval sends' : domain.mode}</Typography>
          </Stack>
        </ButtonBase>;
      })}
    </Box>
  </Box>;
}
