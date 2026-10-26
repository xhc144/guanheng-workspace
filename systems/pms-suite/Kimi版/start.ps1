# Windows demo launcher: backend 8101, frontend 5181
param([switch]$ResetDemo)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$py = Join-Path $backend '.venv\Scripts\python.exe'
$backendProc = $null
$frontendProc = $null

function Test-PortAvailable([int]$Port) {
  return -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Stop-ProcessTree($Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
  }
}

if (-not (Test-Path -LiteralPath $py)) { throw "Python virtual environment not found: $py" }
if (-not (Test-PortAvailable 8101)) { throw 'Port 8101 is already in use; no existing process was stopped.' }
if (-not (Test-PortAvailable 5181)) { throw 'Port 5181 is already in use; no existing process was stopped.' }

try {
  $demoAction = if ($ResetDemo) { 'Reset' } else { 'Verify' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'demo.ps1') -Action $demoAction
  if ($LASTEXITCODE -ne 0) { throw 'Demo database preparation failed.' }

  $oldDemoMode = $env:DEMO_MODE
  $oldDatabaseUrl = $env:DATABASE_URL
  $env:DEMO_MODE = '1'
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  $backendProc = Start-Process -FilePath $py -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8101' -WorkingDirectory $backend -PassThru
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8101/api/v1/health' -TimeoutSec 1).status -eq 'ok') { break }
    } catch {}
    if ($i -eq 29) { throw 'Backend did not become healthy on port 8101.' }
  }
  $frontendProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' -WorkingDirectory $frontend -PassThru
  Write-Host 'Demo is running at http://127.0.0.1:5181  (admin / Admin@123456)'
  Write-Host 'Press Ctrl+C to stop the processes started by this script.'
  Start-Process 'http://127.0.0.1:5181'
  Wait-Process -Id $frontendProc.Id
} finally {
  Stop-ProcessTree $frontendProc
  Stop-ProcessTree $backendProc
  if ($null -eq $oldDemoMode) { Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue } else { $env:DEMO_MODE = $oldDemoMode }
  if ($null -eq $oldDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $oldDatabaseUrl }
}
