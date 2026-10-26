@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 综合项目管理系统 - 验收演示

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "DEMO_DB=%BACKEND%\.demo\demo.db"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

if not exist "%PYTHON%" set "PYTHON=python"
where "%PYTHON%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 Python。请安装 Python 3.10+ 或创建 backend\.venv。
    exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 Node.js。请安装 Node.js 18+。
    exit /b 1
)

if not exist "%DEMO_DB%" (
    echo [INFO] 演示库不存在，正在创建 backend\.demo\demo.db...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%reset-demo.ps1"
    if errorlevel 1 exit /b 1
)

set "DATABASE_URL=sqlite:///%DEMO_DB:\=/%"
set "DEMO_MODE=true"

echo [1/2] 启动后端: http://127.0.0.1:8102
start "PMS-Backend" cmd /k "cd /d "%BACKEND%" ^&^& set DATABASE_URL=%DATABASE_URL% ^&^& set DEMO_MODE=true ^&^& "%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8102 --reload"

echo [2/2] 启动前端: http://127.0.0.1:5182
start "PMS-Frontend" cmd /k "cd /d "%FRONTEND%" ^&^& npm run dev"

echo.
echo ========================================
echo   后端: http://127.0.0.1:8102
echo   API 文档: http://127.0.0.1:8102/docs
echo   前端: http://127.0.0.1:5182
echo   验收账号: admin / Admin@123456
echo   演示数据库: backend\.demo\demo.db
echo.
echo   重置演示数据: powershell -ExecutionPolicy Bypass -File reset-demo.ps1
echo ========================================
endlocal
