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

# No demo operation runs alongside an install or a running backend.
$guardLocks = @()
$logRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'logs'
if ((Test-Path -LiteralPath $logRoot) -and ((Get-Item -LiteralPath $logRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接日志目录。' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
try {
    foreach ($suffix in @('session', 'all', 'backend', 'install')) {
        $guardPath = Join-Path $logRoot ('deepseek-' + $suffix + '.lock')
        if ((Test-Path -LiteralPath $guardPath) -and ((Get-Item -LiteralPath $guardPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接锁文件。' }
        $guardLocks += [IO.File]::Open($guardPath, 'OpenOrCreate', 'ReadWrite', 'None')
    }
    foreach ($port in @(8102, 5182)) {
        $client = New-Object Net.Sockets.TcpClient
        $occupied = $false
        try {
            $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
            if ($pending.AsyncWaitHandle.WaitOne(300)) { $client.EndConnect($pending); $occupied = $client.Connected }
        } catch { } finally { $client.Dispose() }
        if ($occupied) { throw "端口 $port 已被占用。" }
    }
}
catch {
    foreach ($guard in $guardLocks) { $guard.Dispose() }
    throw '演示操作拒绝：请先停止本版服务并等待安装结束；不会停止占用者。'
}

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
    foreach ($guard in $guardLocks) { $guard.Dispose() }
}
