$demoOriginalLocation = Get-Location
try {
    Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
    $demoUserPassword = Read-Host 'Choose the presentation USER password' -AsSecureString
    $demoManagerPassword = Read-Host 'Choose the presentation MANAGER password' -AsSecureString
    $demoPayload = @{
        userPassword = [System.Net.NetworkCredential]::new('', $demoUserPassword).Password
        managerPassword = [System.Net.NetworkCredential]::new('', $demoManagerPassword).Password
    } | ConvertTo-Json -Compress
    $demoPayload | npm run demo:setup
    if ($LASTEXITCODE -ne 0) { throw 'Presentation setup failed; see the message above.' }
} finally {
    $demoPayload = $null
    $demoUserPassword = $null
    $demoManagerPassword = $null
    Set-Location -LiteralPath $demoOriginalLocation.Path
}
