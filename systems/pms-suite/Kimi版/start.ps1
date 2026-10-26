[CmdletBinding()]
param([switch]$ResetDemo, [switch]$NoBrowser, [switch]$NoPopup)
$ErrorActionPreference = 'Stop'
if ($ResetDemo) { throw '启动入口不重置已有数据。确需清空演示库时，停止服务后单独运行 demo.ps1 -Action Reset -Confirm。' }
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'start-helper.ps1') -Edition Kimi -NoBrowser:$NoBrowser -NoPopup:$NoPopup
exit $LASTEXITCODE
