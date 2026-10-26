[CmdletBinding()]
param([switch]$NoBrowser, [switch]$NoPopup)
$ErrorActionPreference = 'Stop'
& (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'start-helper.ps1') -Edition Basic -Component Frontend -NoBrowser:$NoBrowser -NoPopup:$NoPopup
exit $LASTEXITCODE
