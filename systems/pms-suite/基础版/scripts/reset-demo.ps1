[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
foreach ($path in @($backend, (Join-Path $backend '.demo'), (Join-Path $backend '.demo/demo.db'), (Join-Path $backend '.demo/demo.db-wal'), (Join-Path $backend '.demo/demo.db-shm'))) {
    if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接或重解析路径。' }
}
$python = if ($env:OS -eq 'Windows_NT') { Join-Path $root '.venv/Scripts/python.exe' } else { Join-Path $root '.venv/bin/python' }
if (-not (Test-Path -LiteralPath $python)) { throw '缺少基础版隔离 venv；请先运行统一 helper 的 -InstallOnly。' }
foreach ($directory in @($root, $backend)) {
    if (Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' }) { throw '演示操作拒绝本地环境文件，请在独立的干净源码目录运行。' }
}

# No demo operation runs alongside an install or a running backend.
$guardLocks = @()
$logRoot = Join-Path (Split-Path -Parent $root) 'logs'
if ((Test-Path -LiteralPath $logRoot) -and ((Get-Item -LiteralPath $logRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接日志目录。' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
try {
    foreach ($suffix in @('session', 'all', 'backend', 'install')) {
        $guardPath = Join-Path $logRoot ('basic-' + $suffix + '.lock')
        if ((Test-Path -LiteralPath $guardPath) -and ((Get-Item -LiteralPath $guardPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '演示操作拒绝链接锁文件。' }
        $guardLocks += [IO.File]::Open($guardPath, 'OpenOrCreate', 'ReadWrite', 'None')
    }
    foreach ($port in @(8100, 5180)) {
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

Push-Location -LiteralPath $backend
try {
    & $python -c 'from app.demo import ensure_demo_database_url; ensure_demo_database_url()'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not $PSCmdlet.ShouldProcess((Join-Path $backend '.demo/demo.db'), '清空基础版受控演示库并初始化')) { return }
    & $python -m scripts.demo_db reset
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally { Pop-Location; foreach ($guard in $guardLocks) { $guard.Dispose() } }
