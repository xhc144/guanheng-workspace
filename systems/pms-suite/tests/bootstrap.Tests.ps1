BeforeAll {
    $script:helperSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'start-helper.ps1'
    $script:hostExecutable = (Get-Process -Id $PID).Path
    $script:fixture = Join-Path $TestDrive '中文 空格 PMS'
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    Copy-Item -LiteralPath $helperSource -Destination (Join-Path $fixture 'start-helper.ps1')
    foreach ($edition in @('基础版', 'DeepSeek版', 'Kimi版')) {
        foreach ($part in @('backend', 'frontend')) { New-Item -ItemType Directory -Path (Join-Path (Join-Path $fixture $edition) $part) -Force | Out-Null }
    }
    function Invoke-Fixture([string]$Edition = 'Basic', [hashtable]$Environment = @{}) {
        $saved = @{}
        try {
            foreach ($key in @('DATABASE_URL', 'ENVIRONMENT', 'DEMO_MODE')) {
                $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
            }
            foreach ($key in $Environment.Keys) {
                if (-not $saved.ContainsKey($key)) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
                [Environment]::SetEnvironmentVariable($key, $Environment[$key], 'Process')
            }
            $output = & $hostExecutable -NoProfile -File (Join-Path $fixture 'start-helper.ps1') -Edition $Edition -NoBrowser -NoPopup 2>&1
            return @{ Code = $LASTEXITCODE; Output = ($output | Out-String) }
        }
        finally { foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') } }
    }
}

Describe 'PMS bootstrap real refusal paths (no mocked service success)' {
    It '从中文空格路径定位，缺少Python时中文拒绝且未创建venv/演示库' {
        $result = Invoke-Fixture -Environment @{ PATH = '' }
        $result.Code | Should -Be 1
        $result.Output | Should -Match '未找到.*Python'
        Test-Path -LiteralPath (Join-Path $fixture '基础版/.venv') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $fixture '基础版/backend/.demo') | Should -BeFalse
        @(Get-ChildItem -LiteralPath (Join-Path $fixture 'logs') -Recurse -Filter startup.log).Count | Should -BeGreaterThan 0
    }

    It '真实监听器占用端口时拒绝，保留占用者和原演示内容' {
        $demoDir = Join-Path $fixture '基础版/backend/.demo'
        New-Item -ItemType Directory -Path $demoDir -Force | Out-Null
        $marker = Join-Path $demoDir 'demo.db'
        [IO.File]::WriteAllText($marker, 'synthetic-preserve-marker')
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8100)
        $listener.Start()
        try {
            $result = Invoke-Fixture
            $result.Code | Should -Be 1
            $result.Output | Should -Match '端口 8100 已被占用'
            $listener.Server.IsBound | Should -BeTrue
            [IO.File]::ReadAllText($marker) | Should -Be 'synthetic-preserve-marker'
        }
        finally { $listener.Stop(); Remove-Item -LiteralPath $marker }
    }

    It '生产环境拒绝且不回显合成密钥' {
        $result = Invoke-Fixture -Environment @{ ENVIRONMENT = 'production'; SECRET_KEY = 'WP02-synthetic-do-not-echo' }
        $result.Code | Should -Be 1
        $result.Output | Should -Match 'ENVIRONMENT'
        $result.Output | Should -Not -Match 'WP02-synthetic-do-not-echo'
    }

    It '其他DATABASE_URL拒绝且保留合成保护文件' {
        $protected = Join-Path $TestDrive 'protected.db'
        [IO.File]::WriteAllText($protected, 'synthetic-protected-content')
        $result = Invoke-Fixture -Environment @{ DATABASE_URL = 'sqlite:///' + $protected.Replace('\', '/') }
        $result.Code | Should -Be 1
        $result.Output | Should -Match '其他 DATABASE_URL'
        $result.Output | Should -Not -Match ([regex]::Escape($protected))
        [IO.File]::ReadAllText($protected) | Should -Be 'synthetic-protected-content'
    }

    It '前端环境文件拒绝且不读取或覆盖内容' {
        $config = Join-Path $fixture 'Kimi版/frontend/.env.development.local'
        [IO.File]::WriteAllText($config, 'WP02_SYNTHETIC_PRIVATE=keep-me')
        try {
            $result = Invoke-Fixture -Edition Kimi
            $result.Code | Should -Be 1
            $result.Output | Should -Match '本地环境配置文件'
            $result.Output | Should -Not -Match 'keep-me'
            [IO.File]::ReadAllText($config) | Should -Be 'WP02_SYNTHETIC_PRIVATE=keep-me'
        }
        finally { Remove-Item -LiteralPath $config -Force }
    }

    It '并发安装锁拒绝，不启动任何服务' {
        $lock = [IO.File]::Open((Join-Path $fixture 'logs/deepseek-all.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        try {
            $result = Invoke-Fixture -Edition DeepSeek
            $result.Code | Should -Be 1
            $result.Output | Should -Match '已有启动或安装任务'
            Test-Path -LiteralPath (Join-Path $fixture 'DeepSeek版/backend/.venv') | Should -BeFalse
        }
        finally { $lock.Dispose() }
    }
}
