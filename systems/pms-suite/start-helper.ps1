param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Basic', 'DeepSeek', 'Kimi')]
    [string]$Edition,
    [switch]$NoBrowser,
    [switch]$NoPopup
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$logRoot = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Join-UnicodeName([int[]]$CodePoints) {
    return -join ($CodePoints | ForEach-Object { [char]$_ })
}

function Test-TcpPort([int]$Port) {
    $client = $null
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        return $result.AsyncWaitHandle.WaitOne(500)
    }
    catch { return $false }
    finally { if ($null -ne $client) { $client.Dispose() } }
}

function Test-WebReady([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch { return $false }
}

function Wait-WebReady([string]$Name, [string]$Url, [int]$Port, $Process, [int]$Seconds = 60) {
    $attempts = $Seconds * 2
    for ($i = 0; $i -lt $attempts; $i++) {
        if (Test-WebReady $Url) { return }
        if ($null -ne $Process -and $Process.HasExited) {
            throw "$Name exited during startup (exit code $($Process.ExitCode))."
        }
        Start-Sleep -Milliseconds 500
    }
    if (Test-TcpPort $Port) {
        throw "$Name opened port $Port but did not return a valid web response within $Seconds seconds."
    }
    throw "$Name did not start on port $Port within $Seconds seconds."
}

function Assert-PortUsable([string]$Name, [int]$Port, [string]$ReadyUrl) {
    if ((Test-TcpPort $Port) -and -not (Test-WebReady $ReadyUrl)) {
        throw "Port $Port is already occupied by another or unhealthy process; $Name was not started."
    }
}

function Start-LoggedProcess(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$LogPrefix
) {
    $outLog = Join-Path $logRoot ($LogPrefix + '-out.log')
    $errLog = Join-Path $logRoot ($LogPrefix + '-error.log')
    Write-Host "Starting $Name ..."
    return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

function Invoke-NpmInstallIfNeeded([string]$Frontend, [string]$Npm) {
    if (Test-Path -LiteralPath (Join-Path $Frontend 'node_modules')) { return }
    Write-Host 'Installing missing frontend dependencies ...'
    Push-Location $Frontend
    try {
        & $Npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}

function Set-TemporaryEnvironment([hashtable]$Values, [scriptblock]$Action) {
    $saved = @{}
    try {
        foreach ($key in $Values.Keys) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $Values[$key], 'Process')
        }
        & $Action
    }
    finally {
        foreach ($key in $Values.Keys) {
            [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
        }
    }
}

try {
    $basicName = Join-UnicodeName @(0x57FA, 0x7840, 0x7248)
    $editionName = switch ($Edition) {
        'Basic' { $basicName }
        'DeepSeek' { 'DeepSeek' + [char]0x7248 }
        'Kimi' { 'Kimi' + [char]0x7248 }
    }
    $target = Join-Path $root $editionName
    $backend = Join-Path $target 'backend'
    $frontend = Join-Path $target 'frontend'
    $python = if ($Edition -eq 'Basic') {
        Join-Path $target '.venv\Scripts\python.exe'
    } else {
        Join-Path $backend '.venv\Scripts\python.exe'
    }
    $ports = switch ($Edition) {
        'Basic' { @{ Backend = 8100; Frontend = 5180 } }
        'Kimi' { @{ Backend = 8101; Frontend = 5181 } }
        'DeepSeek' { @{ Backend = 8102; Frontend = 5182 } }
    }
    $backendUrl = "http://127.0.0.1:$($ports.Backend)/docs"
    $frontendUrl = "http://127.0.0.1:$($ports.Frontend)"

    foreach ($path in @($target, $backend, $frontend, $python)) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required path not found: $path" }
    }
    $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
    if ($null -eq $npmCommand) { throw 'Node.js/npm was not found. Install Node.js 18 or newer.' }

    Assert-PortUsable 'backend' $ports.Backend $backendUrl
    Assert-PortUsable 'frontend' $ports.Frontend $frontendUrl
    Invoke-NpmInstallIfNeeded $frontend $npmCommand.Source

    $backendProcess = $null
    if (-not (Test-WebReady $backendUrl)) {
        $environment = @{}
        if ($Edition -eq 'DeepSeek') {
            $demoDb = Join-Path $backend '.demo\demo.db'
            if (-not (Test-Path -LiteralPath $demoDb)) {
                $resetScript = Join-Path $target 'reset-demo.ps1'
                $resetOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $resetScript 2>&1
                if ($LASTEXITCODE -ne 0) {
                    throw "DeepSeek demo database initialization failed: $($resetOutput -join ' ')"
                }
            }
            $environment['DEMO_MODE'] = 'true'
            $environment['DATABASE_URL'] = 'sqlite:///' + $demoDb.Replace('\', '/')
        }
        elseif ($Edition -eq 'Kimi') {
            $demoScript = Join-Path $target 'demo.ps1'
            $demoOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $demoScript -Action Verify 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "Kimi demo database verification failed: $($demoOutput -join ' ')"
            }
            $environment['DEMO_MODE'] = '1'
            $environment['DATABASE_URL'] = $null
        }

        if ($environment.Count -gt 0) {
            Set-TemporaryEnvironment $environment {
                $script:backendProcess = Start-LoggedProcess 'backend' $python `
                    @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', [string]$ports.Backend) `
                    $backend ($Edition.ToLowerInvariant() + '-backend')
            }
        }
        else {
            $backendProcess = Start-LoggedProcess 'backend' $python `
                @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', [string]$ports.Backend) `
                $backend ($Edition.ToLowerInvariant() + '-backend')
        }
        Wait-WebReady 'backend' $backendUrl $ports.Backend $backendProcess 60
    }
    else { Write-Host 'Backend is already ready.' }

    $frontendProcess = $null
    if (-not (Test-WebReady $frontendUrl)) {
        $frontendProcess = Start-LoggedProcess 'frontend' $npmCommand.Source @('run', 'dev') `
            $frontend ($Edition.ToLowerInvariant() + '-frontend')
        Wait-WebReady 'frontend' $frontendUrl $ports.Frontend $frontendProcess 90
    }
    else { Write-Host 'Frontend is already ready.' }

    Write-Host "READY: $Edition edition is available at $frontendUrl"
    if (-not $NoBrowser) { Start-Process $frontendUrl }
    exit 0
}
catch {
    $message = "START FAILED ($Edition): $($_.Exception.Message)"
    $failureLog = Join-Path $logRoot ($Edition.ToLowerInvariant() + '-startup-error.log')
    "$(Get-Date -Format o) $message`r`n$($_.ScriptStackTrace)" | Set-Content -LiteralPath $failureLog -Encoding UTF8
    Write-Error "$message See log: $failureLog"
    if (-not $NoPopup) {
        try {
            $shell = New-Object -ComObject WScript.Shell
            $null = $shell.Popup("$message`n`nLog: $failureLog", 0, 'Project Management System', 16)
        }
        catch {}
    }
    exit 1
}
