[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Basic', 'DeepSeek', 'Kimi')][string]$Edition,
    [ValidateSet('All', 'Backend', 'Frontend')][string]$Component = 'All',
    [switch]$InstallOnly,
    [switch]$NoBrowser,
    [switch]$NoPopup
)

$ErrorActionPreference = 'Stop'
# Compatible with Windows PowerShell 5.1 and PowerShell 7.
$root = $PSScriptRoot
$stage = '准备日志'
$exitCode = 1
$ownedProcesses = @()
$savedEnvironment = @{}
$logDirectory = $null
$lockStream = $null
$installLock = $null
$isWindowsHost = $env:OS -eq 'Windows_NT'

function Write-Stage([string]$Name) {
    $script:stage = $Name
    $line = "$(Get-Date -Format o) [$Edition][$Name]"
    Write-Host $line
    Add-Content -LiteralPath (Join-Path $logDirectory 'startup.log') -Value $line -Encoding UTF8
}

function Assert-PlainPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "拒绝访问链接或重解析路径：$Path"
        }
    }
}

function Find-Application([string[]]$Names, [string]$Description) {
    foreach ($name in $Names) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command) { return $command.Source }
    }
    throw "未找到$Description；请安装并确认 PATH，然后重新打开启动窗口。"
}

function Invoke-Step([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    Write-Stage $Name
    $outLog = Join-Path $logDirectory ($Name + '.log')
    Push-Location -LiteralPath $Directory
    try {
        # Native stderr must be logged without terminating on Windows PowerShell 5.1.
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { & $Executable @Arguments > $outLog 2>&1; $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $oldPreference }
        Add-Content -LiteralPath (Join-Path $logDirectory 'startup.log') -Encoding UTF8 -Value "cwd=$Directory; step=$Name; exit=$code"
        if ($code -ne 0) {
            $script:exitCode = if ($code -gt 0 -and $code -le 255) { $code } else { 1 }
            throw "子命令失败，退出码 $code；详情：$outLog"
        }
    }
    finally { Pop-Location }
}

function Test-TcpPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(300)) { return $false }
        $client.EndConnect($result)
        return $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Assert-FreePort([int]$Port) {
    if (Test-TcpPort $Port) { throw "端口 $Port 已被占用；未启动新服务，也不会停止占用者。请由操作者确认并正常关闭原服务。" }
}

function Start-ServiceProcess([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    Write-Stage ("启动" + $Name)
    # Arguments are fixed relative paths/options: no cmd /c or interpolated shell command.
    $options = @{
        FilePath = $Executable; ArgumentList = $Arguments; WorkingDirectory = $Directory
        PassThru = $true; RedirectStandardOutput = (Join-Path $logDirectory ($Name + '-out.log'))
        RedirectStandardError = (Join-Path $logDirectory ($Name + '-error.log'))
    }
    if ($isWindowsHost) { $options.WindowStyle = 'Hidden' }
    $process = Start-Process @options
    $script:ownedProcesses += $process
    Add-Content -LiteralPath (Join-Path $logDirectory 'startup.log') -Encoding UTF8 -Value "cwd=$Directory; service=$Name; pid=$($process.Id)"
    return $process
}

function Wait-Service([string]$Name, [string]$Url, $Process, [switch]$JsonHealth) {
    Write-Stage ("检查" + $Name)
    for ($i = 0; $i -lt 120; $i++) {
        $Process.Refresh()
        if ($Process.HasExited) {
            $code = $Process.ExitCode
            $script:exitCode = if ($code -gt 0 -and $code -le 255) { $code } else { 1 }
            throw "$Name 提前退出，退出码 $code。"
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                if ($JsonHealth) {
                    if (($response.Content | ConvertFrom-Json).status -eq 'ok') { return }
                }
                elseif ($response.Content -match '<html') { return }
            }
        }
        catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name 健康检查超时：$Url；请查看本次服务日志。"
}

try {
    Assert-PlainPath (Join-Path $root 'logs')
    $logDirectory = Join-Path (Join-Path $root 'logs') ("{0}-{1}-{2}" -f $Edition.ToLowerInvariant(), (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $PID)
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Write-Stage '检查目录与演示边界'
    $editionName = switch ($Edition) { 'Basic' { '基础版' }; 'DeepSeek' { 'DeepSeek版' }; 'Kimi' { 'Kimi版' } }
    $target = Join-Path $root $editionName
    $backend = Join-Path $target 'backend'
    $frontend = Join-Path $target 'frontend'
    $demoDirectory = Join-Path $backend '.demo'
    $demoDatabase = Join-Path $demoDirectory 'demo.db'
    foreach ($path in @($target, $backend, $frontend)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "缺少版本目录：$path" }
        Assert-PlainPath $path
    }
    foreach ($path in @($demoDirectory, $demoDatabase, "$demoDatabase-wal", "$demoDatabase-shm")) { Assert-PlainPath $path }
    foreach ($directory in @($target, $backend, $frontend)) {
        $localConfig = Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' }
        if ($localConfig) { throw '检测到本地环境配置文件；演示启动拒绝读取或覆盖它，请使用独立的干净源码目录。' }
    }
    if ($env:ENVIRONMENT -and $env:ENVIRONMENT.Trim().ToLowerInvariant() -notin @('development', 'test')) {
        throw '当前 ENVIRONMENT 不是本地演示环境；拒绝启动，不覆盖环境设置。'
    }
    $demoUrl = 'sqlite:///' + $demoDatabase.Replace('\', '/')
    if ($env:DATABASE_URL -and $env:DATABASE_URL -ne $demoUrl) { throw '检测到其他 DATABASE_URL；拒绝连接或覆盖该配置。请使用独立演示终端。' }
    # FileShare.None prevents concurrent installs; release on every exit path.
    $lockPath = Join-Path (Join-Path $root 'logs') ($Edition.ToLowerInvariant() + '-' + $Component.ToLowerInvariant() + '.lock')
    Assert-PlainPath $lockPath
    try { $lockStream = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw '该版本已有启动或安装任务；请等待或关闭原启动窗口。' }
    $ports = switch ($Edition) {
        'Basic' { @{ Backend = 8100; Frontend = 5180; Prefix = '/api' } }
        'DeepSeek' { @{ Backend = 8102; Frontend = 5182; Prefix = '/api' } }
        'Kimi' { @{ Backend = 8101; Frontend = 5181; Prefix = '/api/v1' } }
    }
    Write-Stage '检查端口'
    if ($Component -ne 'Frontend') { Assert-FreePort $ports.Backend }
    if ($Component -ne 'Backend') { Assert-FreePort $ports.Frontend }

    $installLock = $null
    try { $installLock = [IO.File]::Open((Join-Path (Join-Path $root 'logs') ($Edition.ToLowerInvariant() + '-install.lock')), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw '该版本正在安装依赖；请等待原安装完成后再启动。' }
    Write-Stage '检查运行时'
    $systemPython = Find-Application @('python', 'python3', 'py') ' Python 3.10+（含 venv 和 pip）'
    $node = Find-Application @('node') ' Node.js 22.12+ 和 npm'
    $npm = Find-Application @('npm.cmd', 'npm') ' npm'
    Invoke-Step '检查Python版本' $systemPython @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 2)') $target
    Invoke-Step '检查Node版本' $node @('-e', 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=22 && (Number(process.versions.node.split(String.fromCharCode(46))[0])>22 || Number(process.versions.node.split(String.fromCharCode(46))[1])>=12)?0:2)') $target

    $venv = if ($Edition -eq 'Basic') { Join-Path $target '.venv' } else { Join-Path $backend '.venv' }
    Assert-PlainPath $venv
    $python = if ($isWindowsHost) { Join-Path $venv 'Scripts/python.exe' } else { Join-Path $venv 'bin/python' }
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        Invoke-Step '创建隔离venv' $systemPython @('-m', 'venv', '.venv') (Split-Path -Parent $venv)
    }
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'venv 创建后仍缺少 Python；保留失败目录与日志，请检查本机 venv 支持。' }
    # Always verify/install normally; node_modules or a partial venv alone proves nothing.
    if ($Component -ne 'Frontend') {
    Invoke-Step '安装Python依赖' $python @('-m', 'pip', 'install', '-r', 'requirements.txt') $backend
    Invoke-Step '检查Python依赖' $python @('-m', 'pip', 'check') $backend
    }
    if ($Component -ne 'Backend') {
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'package-lock.json') -PathType Leaf)) { throw '缺少已提交的 package-lock.json；不生成或改写锁文件。' }
    Assert-PlainPath (Join-Path $frontend 'node_modules')
    Invoke-Step '按原锁安装前端' $npm @('ci', '--no-audit', '--no-fund') $frontend
    Invoke-Step '检查前端依赖' $npm @('ls', '--depth=0') $frontend
    }
    if ($null -ne $installLock) { $installLock.Dispose(); $installLock = $null }
    if ($InstallOnly) { Write-Stage '安装完成（未初始化数据库或启动服务）'; $exitCode = 0 }
    else {
        foreach ($key in @('DATABASE_URL', 'DEMO_MODE')) { $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
        $env:DATABASE_URL = $demoUrl
        $env:DEMO_MODE = 'true'
        if ($Component -ne 'Frontend') {
            Write-Stage '准备受控演示库（保留已有数据）'
            if ($Edition -eq 'Kimi') {
                if (-not (Test-Path -LiteralPath $demoDatabase)) {
                    New-Item -ItemType Directory -Path $demoDirectory -Force | Out-Null
                    Invoke-Step '迁移新Kimi演示库' $python @('-m', 'alembic', 'upgrade', 'head') $backend
                    Invoke-Step '初始化新Kimi演示库' $python @('-m', 'app.demo_cli', 'seed') $backend
                }
                Invoke-Step '验证Kimi演示库' $python @('-m', 'app.demo_cli', 'verify') $backend
            }
            # Basic/DeepSeek already own their idempotent controlled demo initialization.
            Assert-FreePort $ports.Backend
            $backendProcess = Start-ServiceProcess '后端' $python @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', [string]$ports.Backend) $backend
            Wait-Service '后端' ("http://127.0.0.1:{0}{1}/health" -f $ports.Backend, $ports.Prefix) $backendProcess -JsonHealth
        }
        $frontendUrl = "http://127.0.0.1:$($ports.Frontend)"
        if ($Component -ne 'Backend') {
            Assert-FreePort $ports.Frontend
            $frontendProcess = Start-ServiceProcess '前端' $node @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', [string]$ports.Frontend, '--strictPort') $frontend
            Wait-Service '前端' $frontendUrl $frontendProcess
        }
        Write-Stage '就绪'
        Write-Host "版本：$editionName；前端：$frontendUrl；API 前缀：$($ports.Prefix)"
        Write-Host "日志：$logDirectory"
        Write-Host '请保持此窗口打开；按 Ctrl+C 正常停止本次启动的服务。重复启动会拒绝占用，不会重置演示库。'
        if (-not $NoBrowser -and $Component -ne 'Backend') { Start-Process $frontendUrl }
        while ($true) {
            foreach ($process in $ownedProcesses) {
                $process.Refresh()
                if ($process.HasExited) {
                    $code = $process.ExitCode
                    $exitCode = if ($code -gt 0 -and $code -le 255) { $code } else { 1 }
                    throw "服务 PID $($process.Id) 已退出，退出码 $code。"
                }
            }
            Start-Sleep -Milliseconds 500
        }
    }
}
catch {
    $message = "启动失败 [$Edition][$stage]：$($_.Exception.Message)；日志：$logDirectory"
    [Console]::Error.WriteLine($message)
    if ($null -ne $logDirectory -and (Test-Path -LiteralPath $logDirectory)) { Add-Content -LiteralPath (Join-Path $logDirectory 'startup.log') -Value $message -Encoding UTF8 }
    if (-not $NoPopup -and $isWindowsHost) {
        try { $shell = New-Object -ComObject WScript.Shell; $null = $shell.Popup($message, 0, 'PMS 启动失败', 16) } catch { }
    }
}
finally {
    foreach ($process in $ownedProcesses) {
        try { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(5000) | Out-Null } } catch { }
    }
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
    if ($null -ne $installLock) { $installLock.Dispose() }
    if ($null -ne $lockStream) { $lockStream.Dispose() }
}
exit $exitCode
