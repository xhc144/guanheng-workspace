[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param([ValidateSet('Prepare', 'Seed', 'Reset', 'Verify')][string]$Action = 'Prepare')

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$demoDirectory = Join-Path $backend '.demo'
$demoDatabase = Join-Path $demoDirectory 'demo.db'
foreach ($path in @($backend, $demoDirectory, $demoDatabase, "$demoDatabase-wal", "$demoDatabase-shm")) {
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接或重解析路径。' }
}
foreach ($directory in @($PSScriptRoot, $backend, (Join-Path $PSScriptRoot 'frontend'))) {
    if (Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' }) { throw '检测到本地环境文件；请在独立的干净源码目录运行演示，不读取或覆盖配置。' }
}
if ($env:ENVIRONMENT -and $env:ENVIRONMENT.Trim().ToLowerInvariant() -notin @('development', 'test')) { throw '演示操作拒绝当前 ENVIRONMENT。' }
$demoUrl = 'sqlite:///' + $demoDatabase.Replace('\', '/')
if ($env:DATABASE_URL -and $env:DATABASE_URL -ne $demoUrl) { throw '演示操作拒绝其他 DATABASE_URL，不连接或覆盖配置。' }
$python = if ($env:OS -eq 'Windows_NT') { Join-Path $backend '.venv/Scripts/python.exe' } else { Join-Path $backend '.venv/bin/python' }
if (-not (Test-Path -LiteralPath $python)) { throw '缺少 backend/.venv；请先运行统一 helper 的 -InstallOnly。' }
$oldDemoMode = [Environment]::GetEnvironmentVariable('DEMO_MODE', 'Process')
$oldDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
try {
    $env:DEMO_MODE = 'true'
    $env:DATABASE_URL = $demoUrl
    Push-Location -LiteralPath $backend
    try {

        & $python -c 'from app.config import settings; settings.require_controlled_demo_database()'
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        if ($WhatIfPreference -and $Action -ne 'Verify') { $null = $PSCmdlet.ShouldProcess($demoDatabase, $Action); return }
        $newDatabase = -not (Test-Path -LiteralPath $demoDatabase)
        if ($Action -eq 'Reset') {
            if (-not $PSCmdlet.ShouldProcess($demoDatabase, '清空受控演示库并重新初始化')) { return }
            foreach ($path in @($demoDatabase, "$demoDatabase-wal", "$demoDatabase-shm")) {
                if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
            }
            $newDatabase = $true
        }
        if ($Action -ne 'Verify' -and $newDatabase) {
            New-Item -ItemType Directory -Path $demoDirectory -Force | Out-Null
            & $python -m alembic upgrade head
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        if ($Action -in @('Seed', 'Reset') -or ($Action -eq 'Prepare' -and $newDatabase)) {
            & $python -m app.demo_cli seed
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        & $python -m app.demo_cli verify
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    }
    finally { Pop-Location }
}
finally {
    [Environment]::SetEnvironmentVariable('DEMO_MODE', $oldDemoMode, 'Process')
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $oldDatabaseUrl, 'Process')
}
