@echo off
title Git Bash 安装器
echo ========================================
echo   下载并安装 Git for Windows
echo   安装后 bash 工具即可正常工作
echo ========================================
echo.

set "GIT_URL=https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
set "INSTALLER=%TEMP%\Git-Installer.exe"

echo [0/2] 检查是否已安装...
where git >nul 2>&1
if %errorlevel% equ 0 (
    echo Git 已安装。跳过安装。
    pause
    exit /b 0
)

echo [1/2] 下载 Git 安装包...
powershell -Command "Invoke-WebRequest -Uri '%GIT_URL%' -OutFile '%INSTALLER%'" 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] 下载失败，请检查网络连接或手动下载：
    echo   https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [2/2] 启动安装程序...
echo   选择默认选项即可。安装完成后重新打开终端。
start /wait "" "%INSTALLER%" /VERYSILENT /NORESTART /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"

echo.
echo Git Bash 安装完成！
echo 请重新打开终端后运行验收脚本：
echo   python verify_goal.py
echo 或:
echo   powershell -File verify_goal.ps1
pause
