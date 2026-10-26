#!/usr/bin/env pwsh
# pi-bash-wrapper.ps1 — Redirect bash calls to PowerShell
# NOTE: pi bash tool hardcodes Git Bash paths and ignores settings.json shellPath.
# This wrapper is preserved for reference; install Git for Windows for bash support.
# Workaround: Run commands directly in host terminal.

$ErrorActionPreference = "Continue"
$args = $args -join " "
# Convert bash syntax to PowerShell
$cmd = $args -replace '&&', ';' -replace '\bcd\b', 'Set-Location' -replace '\|', '|'

try {
    $result = Invoke-Expression $cmd 2>&1
    Write-Output $result
    exit $LASTEXITCODE
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
