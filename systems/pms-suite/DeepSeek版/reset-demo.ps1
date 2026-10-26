[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$DemoDirectory = Join-Path $Backend ".demo"
$DemoDatabase = Join-Path $DemoDirectory "demo.db"

if (-not (Test-Path $Backend)) {
    throw "Backend directory not found: $Backend"
}

# This script has one deletion target by design. It never discovers or touches pms.db.
if (Test-Path $DemoDatabase) {
    if ($PSCmdlet.ShouldProcess($DemoDatabase, "Reset demo database")) {
        Remove-Item -LiteralPath $DemoDatabase -Force
    }
}

if (-not (Test-Path $DemoDirectory)) {
    New-Item -ItemType Directory -Path $DemoDirectory | Out-Null
}

$Python = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    $Python = "python"
}
$DemoUrl = "sqlite:///$($DemoDatabase.Replace('\', '/'))"

Push-Location $Backend
try {
    $env:DEMO_MODE = "true"
    $env:DATABASE_URL = $DemoUrl
    & $Python -c "from app.main import on_startup; on_startup()"
    if ($LASTEXITCODE -ne 0) { throw "Demo database initialization failed" }
} finally {
    Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}

if (-not (Test-Path $DemoDatabase)) {
    throw "Demo database was not created: $DemoDatabase"
}
Write-Host "Demo database reset: $DemoDatabase" -ForegroundColor Green
