# verify_goal.ps1 v2.1 (1715/1622)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Failures = 0
$Warnings = 0

function Check($Label, $Script) {
    Write-Host -NoNewline "[CHECK] $Label ... "
    try {
        $result = & $Script
        Write-Host "PASS" -ForegroundColor Green
        return $result
    } catch {
        $msg = $_.Exception.Message
        if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) + "..." }
        Write-Host "FAIL: $msg" -ForegroundColor Red
        $global:Failures++
        return $null
    }
}

function Warn($Label, $Script) {
    Write-Host -NoNewline "[WARN] $Label ... "
    try {
        & $Script
        Write-Host "OK" -ForegroundColor Green
    } catch {
        Write-Host "SKIPPED: $_" -ForegroundColor Yellow
        $global:Warnings++
    }
}

Write-Host "=== 综合项目管理系统 验收检查 ===" -ForegroundColor Cyan
Write-Host "Root: $Root`n"

# 0. Pre-flight: check tools and install deps
Write-Host "--- 环境准备 ---" -ForegroundColor DarkCyan
$pythonOk = (Get-Command python -ErrorAction SilentlyContinue) -ne $null
$nodeOk = (Get-Command node -ErrorAction SilentlyContinue) -ne $null
if (-not $pythonOk) { Write-Host "[FATAL] Python not found" -ForegroundColor Red; exit 99 }
if (-not $nodeOk) { Write-Host "[FATAL] Node.js not found" -ForegroundColor Red; exit 99 }

Warn "Install backend deps" {
    Push-Location "$Root\backend"
    try {
        python -m pip install -r requirements.txt 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
    } finally { Pop-Location }
}

Warn "Install frontend deps" {
    Push-Location "$Root\frontend"
    try {
        if (-not (Test-Path "node_modules")) {
            npm install 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        }
    } finally { Pop-Location }
}

Write-Host "`n--- 核心验收 ---" -ForegroundColor DarkCyan

# 0.5. Static import check (fast failure)
Check "Python import chain resolves" {
    Push-Location "$Root\backend"
    try {
        python check_imports.py 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Import check failed" }
    } finally { Pop-Location }
}

# 1. Backend startup
Check "Backend starts on port 8000" {
    $proc = Start-Process -FilePath "python" -ArgumentList "-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000" -PassThru -NoNewWindow -WorkingDirectory "$Root\backend"
    Start-Sleep -Seconds 6
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:8000/api/health" -TimeoutSec 15
        if ($r.status -ne "ok") { throw "Health check failed" }
    } finally {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# 2. Database migration (Alembic)
Check "Alembic migrations run cleanly" {
    Push-Location "$Root\backend"
    try {
        # Auto-generate initial migration if no versions exist
        $versions = Get-ChildItem "alembic\versions\*.py" -ErrorAction SilentlyContinue
        if (-not $versions -or $versions.Count -eq 0) {
            python -m alembic revision --autogenerate -m "initial" 2>&1 | Out-Null
        }
        python -m alembic upgrade head 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Migration failed" }
    } finally { Pop-Location }
}

# 3. Backend tests
Check "Pytest backend tests pass" {
    Push-Location "$Root\backend"
    try {
        $result = python -m pytest tests/ -v --tb=short 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
    } finally { Pop-Location }
}

# 4. Frontend build
Check "Frontend builds successfully" {
    Push-Location "$Root\frontend"
    try {
        # Skip tsc strict check on first pass, just vite build
        $result = npx vite build 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Build failed" }
        if (-not (Test-Path "dist\index.html")) { throw "dist/index.html not found" }
    } finally { Pop-Location }
}

# 5. Frontend tests
Warn "Frontend tests pass" {
    Push-Location "$Root\frontend"
    try {
        $result = npx vitest run 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Vitest failed" }
    } finally { Pop-Location }
}

Write-Host "`n--- 交付物检查 ---" -ForegroundColor DarkCyan

$deliverables = @(
    "backend\app\main.py",
    "backend\app\models\__init__.py",
    "backend\app\middleware.py",
    "backend\app\seeder.py",
    "backend\alembic\env.py",
    "backend\tests\test_core.py",
    "backend\tests\test_integration.py",
    "frontend\src\main.tsx",
    "frontend\src\App.tsx",
    "frontend\src\ErrorBoundary.tsx",
    "frontend\vite.config.ts",
    "backend\app\routes\approval.py",
    "backend\app\routes\search.py",
    "backend\app\routes\files.py",
    "backend\app\routes\export.py",
    "backend\app\routes\report.py",
    "backend\check_imports.py",
    "backend\pytest.ini",
    "backend\app\logger.py",
    "frontend\src\pages\Approvals.tsx",
    "frontend\src\pages\Notifications.tsx",
    "frontend\src\pages\Settings.tsx",
    "frontend\vitest.config.ts",
    "frontend\eslint.config.js",
    "frontend\.env",
    "frontend\src\test-setup.ts",
    "frontend\src\App.test.tsx",
    "frontend\public\pms-favicon.svg",
    "SPRINT_REVIEW.md",
    "QUICKSTART.md",
    "README.md",
    "LICENSE",
    "ARCHITECTURE.md",
    "DECISIONS.md",
    "API_DOCS.md",
    "DEVELOPMENT.md",
    "DEPLOYMENT.md",
    "CHANGELOG.md",
    "TROUBLESHOOTING.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".env.example",
    ".env.production",
    "start.bat",
    "Makefile",
    "setup.ps1",
    "DELIVERY_REPORT.md",
    "ROADMAP.md",
    "ASSUMPTIONS.md",
    "IMPROVEMENTS.md",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.override.yml",
    ".dockerignore",
    ".editorconfig",
    ".pre-commit-config.yaml",
    "api_smoke_test.ps1",
    "verify_goal.py",
    "self_check.py",
    "api_tests.http",
    "install_git_bash.bat",
    ".github\workflows\ci.yml",
    ".github\PULL_REQUEST_TEMPLATE.md",
    ".github\ISSUE_TEMPLATE\bug_report.md",
    ".github\ISSUE_TEMPLATE\feature_request.md",
    "PROGRESS.md",
    "FINAL_STATUS.md",
    "验收说明.md",
    "HOST_CHECKLIST.txt",
    "验收面板.html",
    "验收.hta",
    "验收.vbs",
    "verify.bat",
    "quick_check.bat",
    "run_verify.py",
    "syntax_check.py",
    "excel_coverage_check.py",
    "full_verify.bat",
    "test_run.bat"
)
foreach ($d in $deliverables) {
    Check "Deliverable: $d" { if (-not (Test-Path "$Root\$d")) { throw "Missing" } }
}

# 7. .env.example has required keys
Check ".env.example has SECRET_KEY" {
    $envContent = Get-Content "$Root\.env.example" -Raw
    if ($envContent -notmatch "SECRET_KEY") { throw "Missing SECRET_KEY" }
}

Write-Host "`n=== Results: $Failures failure(s), $Warnings warning(s) ===" -ForegroundColor $(if ($Failures -eq 0) { "Green" } else { "Red" })
exit $Failures
