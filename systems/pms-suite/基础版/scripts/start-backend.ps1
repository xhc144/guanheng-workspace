$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "未找到 $python"
}

Push-Location (Join-Path $root "backend")
try {
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload
}
finally {
    Pop-Location
}
