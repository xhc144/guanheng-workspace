# 停止综合项目管理系统 — 按端口停止前后端服务进程
$ErrorActionPreference = 'SilentlyContinue'
$killed = 0
foreach ($port in 8102, 5182) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -gt 4) {
            try { Stop-Process -Id $procId -Force -ErrorAction Stop; $killed++ } catch {}
        }
    }
}
# 兜底: 用 netstat 再扫一遍
$out = netstat -ano | Select-String ':8102' | Select-String 'LISTENING'
$out += netstat -ano | Select-String ':5182' | Select-String 'LISTENING'
foreach ($line in $out) {
    $parts = ($line.ToString().Trim() -split '\s+')
    $procId = [int]$parts[-1]
    if ($procId -gt 4) {
        try { Stop-Process -Id $procId -Force -ErrorAction Stop; $killed++ } catch {}
    }
}
Write-Host ('已停止 {0} 个服务进程' -f $killed)
