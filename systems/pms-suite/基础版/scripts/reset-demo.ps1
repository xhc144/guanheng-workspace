$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "未找到 $python"
}

Push-Location (Join-Path $root "backend")
try {
    # 删除操作仅由 app.demo 中的受控路径校验执行。
    & $python -m scripts.demo_db reset
}
finally {
    Pop-Location
}
