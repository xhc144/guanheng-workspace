[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param([ValidateSet('Initialize', 'Reset')][string]$Action = 'Initialize')

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

        # Validate application ownership before any deletion, including an explicit Reset.
        & $python -c 'from app.config import settings, validate_demo_database_url; validate_demo_database_url(settings.DATABASE_URL)'
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        if (-not $PSCmdlet.ShouldProcess($demoDatabase, "$Action 受控演示库")) { return }
        if ($Action -eq 'Reset') {
            foreach ($path in @($demoDatabase, "$demoDatabase-wal", "$demoDatabase-shm")) {
                if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
            }
        }
        & $python -c 'from app.main import on_startup; on_startup()'
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        if (-not (Test-Path -LiteralPath $demoDatabase)) { throw '演示数据库未创建。' }
        Write-Host "受控演示库已就绪：$demoDatabase；操作：$Action"

    }
    finally { Pop-Location }
}
finally {
    [Environment]::SetEnvironmentVariable('DEMO_MODE', $oldDemoMode, 'Process')
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $oldDatabaseUrl, 'Process')
}
