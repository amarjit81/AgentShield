import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';

export default function SandboxFields({ value, onChange, disabled }) {
  return <Stack spacing={2} sx={{ my: 2 }}>
    <Alert severity="info">Real files are stored in backend/demo-workspace. Use workspace/ paths; workspace/protected/ is always blocked. Manager-customized path, operation, and content-size rules decide whether each new request is allowed, reviewed, or blocked.</Alert>
    <Typography variant="caption" color="text.secondary">Try a file policy scenario</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
      {[['WRITE', 'workspace/notes.txt', 'Write'], ['READ', 'workspace/notes.txt', 'Read'], ['CHANGE', 'workspace/notes.txt', 'Change'], ['DELETE', 'workspace/notes.txt', 'Delete'], ['READ', 'workspace/protected/notes.txt', 'Protected · block']].map(([operation, path, label]) => <Button key={label} size="small" variant="outlined" disabled={disabled} onClick={() => onChange({ ...value, operation, path })}>{label}</Button>)}
    </Stack>
    <TextField select label="File operation" value={value.operation} disabled={disabled}
      onChange={event => onChange({ ...value, operation: event.target.value })}>
      {['READ', 'WRITE', 'CHANGE', 'DELETE'].map(operation => <MenuItem key={operation} value={operation}>{operation}</MenuItem>)}
    </TextField>
    <TextField label="Sandbox path" value={value.path} disabled={disabled}
      helperText="Example: workspace/notes.txt. Lowercase relative paths with forward slashes."
      onChange={event => onChange({ ...value, path: event.target.value })} />
    {['WRITE', 'CHANGE'].includes(value.operation) && <TextField label={value.operation === 'CHANGE' ? 'Replacement content' : 'Plain-text content'} value={value.content} multiline minRows={4} disabled={disabled}
      helperText="Hard maximum 8,000 UTF-8 bytes; the current sandbox policy may set a smaller limit. Empty content is allowed."
      onChange={event => onChange({ ...value, content: event.target.value })} />}
  </Stack>;
}
