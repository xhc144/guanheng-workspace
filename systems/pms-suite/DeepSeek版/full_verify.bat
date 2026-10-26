@echo off
REM 综合项目管理系统 — 一键完整验证
REM 用法: .\full_verify.bat
REM 要求: Python 3.10+, Node.js 18+, Git Bash (可选)

echo ================================================================
echo   综合项目管理系统 v1.0.0 — 完整验证
echo ================================================================

cd /d "%~dp0"

echo.
echo [1/6] Python语法检查...
python syntax_check.py
if %errorlevel% neq 0 (echo [FAIL] 语法错误 & exit /b 1)
echo [PASS] 语法

echo.
echo [2/6] 后端导入链...
python backend\check_imports.py
if %errorlevel% neq 0 (echo [FAIL] 导入链 & exit /b 1)
echo [PASS]

echo.
echo [3/6] 交付物...
python verify_goal.py
if %errorlevel% neq 0 (echo [FAIL] 验收脚本 & exit /b %errorlevel%)
echo [PASS]

echo.
echo [4/6] 前端构建...
cd frontend
call npm install --silent 2>nul
call npm run build
if %errorlevel% neq 0 (echo [FAIL] 前端构建 & exit /b 1)
cd ..
echo [PASS]

echo.
echo [5/6] 后端测试...
cd backend
call pip install -r requirements.txt -q 2>nul
call pytest tests/ -x --tb=short -q
if %errorlevel% neq 0 (echo [FAIL] 测试 & exit /b 1)
cd ..
echo [PASS]

echo.
echo [6/6] 自检...
python self_check.py
if %errorlevel% neq 0 (echo [FAIL] 自检 & exit /b 1)

echo.
echo ================================================================
echo   全部通过! 系统就绪.
echo ================================================================
