$ErrorActionPreference = 'Stop'
$backendDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = Join-Path $backendDirectory '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw 'Create backend/.env with DATABASE_URL and JWT_SECRET first. See .env.example.'
}
$senderAddress = (Read-Host 'Gmail sender address').Trim().ToLowerInvariant()
$recipientAddress = (Read-Host 'Your test inbox address').Trim().ToLowerInvariant()
foreach ($address in @($senderAddress, $recipientAddress)) {
  if ($address -notmatch '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') {
    throw 'Enter a single plain email address.'
  }
}
$secureAppPassword = Read-Host 'Gmail app password (hidden; not your Google login password)' -AsSecureString
try {
  $appPassword = [System.Net.NetworkCredential]::new('', $secureAppPassword).Password -replace '\s', ''
  if ($appPassword -notmatch '^[A-Za-z]{16}$') { throw 'Expected the 16-letter Gmail app password.' }
  $settings = [ordered]@{
    EMAIL_DELIVERY_MODE = 'SMTP'; SMTP_HOST = 'smtp.gmail.com'; SMTP_PORT = '465'
    SMTP_USER = $senderAddress; SMTP_PASSWORD = $appPassword; SMTP_FROM = $senderAddress
    EMAIL_ALLOWED_RECIPIENTS = $recipientAddress
  }
  $content = [System.IO.File]::ReadAllText($envPath)
  foreach ($key in $settings.Keys) {
    $pattern = '(?m)^[ \t]*(?:export[ \t]+)?' + [regex]::Escape($key) + '[ \t]*=[^\r\n]*\r?$'
    $content = [regex]::Replace($content, $pattern, '')
  }
  $lines = foreach ($key in $settings.Keys) { $key + '="' + $settings[$key] + '"' }
  $content = $content.TrimEnd() + "`r`n" + ($lines -join "`r`n") + "`r`n"
  [System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host 'Gmail settings saved locally. Run npm run email:verify, then restart the backend.'
  Write-Host 'No email was sent. Use the dashboard to submit, approve, and send a fresh request.'
} finally {
  $appPassword = $null; $content = $null; $settings = $null; $lines = $null
  $secureAppPassword.Dispose(); $secureAppPassword = $null
}
