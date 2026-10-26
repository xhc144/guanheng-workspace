param(
  [ValidateSet('Seed', 'Reset', 'Verify')]
  [string]$Action = 'Verify'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$demoDir = Join-Path $backend '.demo'
$demoDb = Join-Path $demoDir 'demo.db'
$protectedDb = Join-Path $backend 'app.db'
$py = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $py)) { throw "Python virtual environment not found: $py" }
$protectedResolved = Resolve-Path -LiteralPath $protectedDb -ErrorAction SilentlyContinue
$demoResolved = Resolve-Path -LiteralPath $demoDb -ErrorAction SilentlyContinue
if ($null -ne $protectedResolved -and $null -ne $demoResolved -and $protectedResolved.Path -eq $demoResolved.Path) {
  throw 'Refusing to operate: demo database resolves to app.db.'
}

$oldDemoMode = $env:DEMO_MODE
$oldDatabaseUrl = $env:DATABASE_URL
$env:DEMO_MODE = '1'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
try {
  if ($Action -eq 'Reset') {
    New-Item -ItemType Directory -Force -Path $demoDir | Out-Null
    foreach ($path in @($demoDb, "$demoDb-wal", "$demoDb-shm")) {
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Push-Location $backend
    try {
      & $py -m alembic upgrade head
      if ($LASTEXITCODE -ne 0) { throw 'Alembic migration failed.' }
    } finally { Pop-Location }
    Push-Location $backend
    try {
      & $py -m app.demo_cli seed
      if ($LASTEXITCODE -ne 0) { throw 'Demo seed failed.' }
    } finally { Pop-Location }
  }
  if ($Action -eq 'Seed') {
    Push-Location $backend
    try {
      & $py -m app.demo_cli seed
      if ($LASTEXITCODE -ne 0) { throw 'Demo seed failed.' }
    } finally { Pop-Location }
  }
  Push-Location $backend
  try {
    & $py -m app.demo_cli verify
    if ($LASTEXITCODE -ne 0) { throw 'Demo verification failed.' }
  } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'Demo verification failed.' }
} finally {
  if ($null -eq $oldDemoMode) { Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue } else { $env:DEMO_MODE = $oldDemoMode }
  if ($null -eq $oldDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $oldDatabaseUrl }
}
