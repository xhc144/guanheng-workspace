[CmdletBinding()]
param([switch]$SkipPython, [switch]$SkipNode)
$ErrorActionPreference = 'Stop'
if ($SkipPython -or $SkipNode) { throw '统一安装不支持跳过依赖检查；请运行 setup.ps1，不传 SkipPython/SkipNode。' }
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'start-helper.ps1') -Edition DeepSeek -InstallOnly -NoBrowser -NoPopup
exit $LASTEXITCODE
