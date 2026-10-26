# 综合项目管理系统 — 一键安装脚本
param(
    [switch]$SkipPython = $false,
    [switch]$SkipNode = $false
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== 综合项目管理系统 安装脚本 ===" -ForegroundColor Cyan

# Prerequisites check
foreach ($cmd in @("python", "node")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: $cmd 未安装或不在 PATH 中" -ForegroundColor Red
        exit 1
    }
}

# 1. Backend dependencies
if (-not $SkipPython) {
    Write-Host "`n[1/4] 安装 Python 依赖..." -ForegroundColor Yellow
    Push-Location "$Root\backend"
    try {
        python -m venv venv
        .\venv\Scripts\python -m pip install --upgrade pip
        .\venv\Scripts\pip install -r requirements.txt
        Write-Host "  Python 依赖安装完成" -ForegroundColor Green
    } finally { Pop-Location }
}

# 2. Frontend dependencies
if (-not $SkipNode) {
    Write-Host "`n[2/4] 安装 Node.js 依赖..." -ForegroundColor Yellow
    Push-Location "$Root\frontend"
    try {
        npm install
        Write-Host "  Node.js 依赖安装完成" -ForegroundColor Green
    } finally { Pop-Location }
}

# 3. Initialize database
Write-Host "`n[3/4] 初始化数据库..." -ForegroundColor Yellow
Push-Location "$Root\backend"
try {
    .\venv\Scripts\python -c "from app.database import engine; from app.models import Base; Base.metadata.create_all(bind=engine); print('数据库表创建完成')"
    Write-Host "  数据库初始化完成" -ForegroundColor Green
} finally { Pop-Location }

# 4. Run verification
Write-Host "`n[4/4] 运行验收检查..." -ForegroundColor Yellow
& "$Root\verify_goal.ps1"
