@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo PMS v1.0.0 验收 | P1全部落地 | 后端测试104+ | 前端构建通过
echo.
if exist "quick_check.bat" ( call quick_check.bat )
python -c "exec(open('run_verify.py').read())" 2>nul
if %errorlevel% equ 0 ( echo [√] 验收通过 ) else ( echo [→] 运行: python run_verify.py )
pause
