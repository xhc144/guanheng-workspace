# 一键启动综合项目管理系统 — 双击桌面快捷方式即调用本脚本
# 功能: 检测前后端是否已运行 -> 缺失则静默启动 -> 等前端就绪后自动打开浏览器
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$demoDb = Join-Path $backend '.demo\demo.db'
$py = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

function Test-Port([int]$port) {
    # 尝试 TCP 连接判断端口是否已有服务
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(600)
        $client.Close()
        return $ok
    } catch { return $false }
}

if (-not (Test-Port 8102)) {
    # 演示库不存在时先初始化
    if (-not (Test-Path $demoDb)) {
        Push-Location $backend
        $env:DEMO_MODE = 'true'
        $env:DATABASE_URL = ('sqlite:///' + ($demoDb.Replace('\', '/')))
        & $py -c 'from app.main import on_startup; on_startup()'
        Pop-Location
    }
    $env:DEMO_MODE = 'true'
    $env:DATABASE_URL = ('sqlite:///' + ($demoDb.Replace('\', '/')))
    Start-Process -FilePath $py -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8102') -WorkingDirectory $backend -WindowStyle Hidden
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue
}

if (-not (Test-Port 5182)) {
    if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
        Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'npm install') -WorkingDirectory $frontend -WindowStyle Hidden -Wait
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'npm run dev') -WorkingDirectory $frontend -WindowStyle Hidden
}

# 等待前端就绪(最多 40 秒)后打开浏览器
$ready = $false
for ($i = 0; $i -lt 80; $i++) {
    if (Test-Port 5182) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if ($ready) {
    Start-Process 'http://127.0.0.1:5182'
} else {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup('系统启动超时，请手动运行 start.bat 查看错误信息', 0, '综合项目管理系统', 48)
}
