# Safe acceptance checks. Only backend/.demo/demo.db may be reset or accessed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$py = Join-Path $backend '.venv\Scripts\python.exe'
$backendProc = $null
$fail = @()

function Log([string]$Message) { Write-Host $Message }
function Check([string]$Name, [scriptblock]$Action) {
  try { & $Action; Log "[PASS] $Name" } catch { Log "[FAIL] $Name -- $($_.Exception.Message)"; $script:fail += $Name }
}
function Stop-ProcessTree($Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
  }
}

try {
  if (-not (Test-Path -LiteralPath $py)) { throw "Python virtual environment not found: $py" }
  Check 'protected app.db remains untouched' {
    $appDb = Join-Path $backend 'app.db'
    if (Test-Path -LiteralPath $appDb) { $script:appDbHash = (Get-FileHash -LiteralPath $appDb -Algorithm SHA256).Hash }
  }
  Check 'controlled demo reset' {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'demo.ps1') -Action Reset
    if ($LASTEXITCODE -ne 0) { throw 'demo reset failed' }
  }
  Check 'backend pytest' {
    Push-Location $backend
    try {
      $env:DEMO_MODE = '0'
      & $py -m pytest -q
      if ($LASTEXITCODE -ne 0) { throw 'pytest failed' }
    } finally { Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue; Pop-Location }
  }
  Check 'backend startup and authentication smoke' {
    $oldDemoMode = $env:DEMO_MODE
    $oldDatabaseUrl = $env:DATABASE_URL
    $env:DEMO_MODE = '1'
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $backendProc = Start-Process -FilePath $py -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8101' -WorkingDirectory $backend -PassThru
    $up = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      try {
        if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8101/api/v1/health' -TimeoutSec 1).status -eq 'ok') { $up = $true; break }
      } catch {}
    }
    if (-not $up) { throw 'health endpoint was unavailable' }
    $login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8101/api/v1/auth/login' -ContentType 'application/json' -Body (@{username='admin';password='Admin@123456'} | ConvertTo-Json)
    if (-not $login.access_token) { throw 'login response has no access token' }
    try {
      Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8101/api/v1/auth/login' -ContentType 'application/json' -Body (@{username='admin';password='incorrect'} | ConvertTo-Json) | Out-Null
      throw 'wrong password unexpectedly succeeded'
    } catch {
      if ($_.Exception.Message -match 'wrong password unexpectedly') { throw }
    }
    if ($null -eq $oldDemoMode) { Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue } else { $env:DEMO_MODE = $oldDemoMode }
    if ($null -eq $oldDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $oldDatabaseUrl }
  }
  Check 'frontend typecheck' {
    Push-Location $frontend
    try {
      & npm run typecheck
      if ($LASTEXITCODE -ne 0) { throw 'frontend typecheck failed' }
    } finally { Pop-Location }
  }
  Check 'frontend build' {
    Push-Location $frontend
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path 'dist\index.html')) { throw 'frontend build failed' }
    } finally { Pop-Location }
  }
  Check 'protected app.db unchanged' {
    $appDb = Join-Path $backend 'app.db'
    if ($script:appDbHash) {
      if (-not (Test-Path -LiteralPath $appDb) -or $script:appDbHash -ne (Get-FileHash -LiteralPath $appDb -Algorithm SHA256).Hash) { throw 'app.db changed' }
    }
  }
} finally {
  Stop-ProcessTree $backendProc
}

if ($fail.Count) { Log ('FAILED: ' + ($fail -join ', ')); exit 1 }
Log 'ALL CHECKS PASSED'; exit 0
