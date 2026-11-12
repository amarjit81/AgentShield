import { Alert, Button, Stack, TextField, Typography } from '@mui/material';

export default function EmailFields({ value, onChange, disabled, realDelivery, allowedRecipients = [] }) {
  return <Stack spacing={2} sx={{ my: 2 }}>
    <Alert severity="info">{realDelivery ? 'Real delivery is enabled. Any valid external address can be requested; Manager approval sends it immediately. Blocked domains cannot send. Policy-allowed email still uses Send Real Email.' : 'Simulation: records a receipt without delivering a message. Internal recipients may run automatically; external recipients need review.'}</Alert>
    {!realDelivery && <><Typography variant="caption" color="text.secondary">Try a recipient using the default domain policy</Typography><Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
      {[['colleague@agentshield.test', 'Internal · allow'], ['review@example.com', 'External · review'], ['demo@blocked.example', 'Blocked domain']].map(([recipient, label]) => <Button key={recipient} size="small" variant="outlined" disabled={disabled} onClick={() => onChange({ ...value, recipient })}>{label}</Button>)}
    </Stack></>}
    {realDelivery && allowedRecipients.length > 0 && <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
      {allowedRecipients.map((recipient, index) => <Button key={recipient} size="small" variant="outlined" disabled={disabled}
        onClick={() => onChange({ ...value, recipient })}>Demo recipient {index + 1}: {recipient}</Button>)}
    </Stack>}
    <TextField label="Recipient email" type="email" value={value.recipient} disabled={disabled} onChange={e => onChange({ ...value, recipient: e.target.value })} fullWidth />
    <TextField label="Email subject" value={value.subject} disabled={disabled} onChange={e => onChange({ ...value, subject: e.target.value })} fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
    <TextField label="Email body (plain text)" value={value.body} disabled={disabled} onChange={e => onChange({ ...value, body: e.target.value })} fullWidth multiline minRows={4} helperText="Maximum 8,000 UTF-8 bytes. One recipient; no attachments or CC/BCC." />
  </Stack>;
}
