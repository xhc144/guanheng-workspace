# Compatibility entry point. Starts the controlled demo on backend 8101 and frontend 5181.
& (Join-Path $PSScriptRoot 'start.ps1') @args
exit $LASTEXITCODE
