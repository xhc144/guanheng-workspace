$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process -FilePath (Join-Path $root "backend\.venv\Scripts\python.exe") `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8102") `
    -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden

Start-Process -FilePath "C:\Windows\System32\cmd.exe" `
    -ArgumentList @("/c", "npm run dev -- --host 127.0.0.1") `
    -WorkingDirectory (Join-Path $root "frontend") -WindowStyle Hidden

Start-Sleep -Seconds 4
Start-Process "http://127.0.0.1:5182"
