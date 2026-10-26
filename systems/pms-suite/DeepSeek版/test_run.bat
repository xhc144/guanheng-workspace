@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "LOG=verify_result.log"
echo ===== 验收检查 %date% %time% =====> %LOG%
echo.>> %LOG%

echo [1/4] 检查交付物 (72项)...
python -c "import sys;from pathlib import Path;fs=['backend\\app\\main.py','backend\\app\\models\\__init__.py','backend\\app\\middleware.py','backend\\app\\seeder.py','backend\\alembic\\env.py','backend\\tests\\test_core.py','frontend\\src\\main.tsx','frontend\\src\\App.tsx','frontend\\src\\ErrorBoundary.tsx','frontend\\vite.config.ts','backend\\app\\routes\\approval.py','backend\\app\\routes\\search.py','backend\\app\\routes\\files.py','backend\\app\\routes\\export.py','backend\\app\\routes\\report.py','backend\\check_imports.py','backend\\pytest.ini','backend\\app\\logger.py','frontend\\src\\pages\\Approvals.tsx','frontend\\src\\pages\\Notifications.tsx','frontend\\src\\pages\\Settings.tsx','frontend\\vitest.config.ts','frontend\\eslint.config.js','frontend\\.env','frontend\\src\\test-setup.ts','frontend\\src\\App.test.tsx','frontend\\public\\pms-favicon.svg','SPRINT_REVIEW.md','QUICKSTART.md','README.md','LICENSE','ARCHITECTURE.md','DECISIONS.md','API_DOCS.md','DEVELOPMENT.md','DEPLOYMENT.md','CHANGELOG.md','TROUBLESHOOTING.md','CONTRIBUTING.md','SECURITY.md','.env.example','.env.production','start.bat','Makefile','setup.ps1','DELIVERY_REPORT.md','ROADMAP.md','ASSUMPTIONS.md','IMPROVEMENTS.md','Dockerfile','docker-compose.yml','docker-compose.override.yml','.dockerignore','.editorconfig','.pre-commit-config.yaml','api_smoke_test.ps1','verify_goal.py','self_check.py','api_tests.http','install_git_bash.bat','.github\\workflows\\ci.yml','.github\\PULL_REQUEST_TEMPLATE.md','.github\\ISSUE_TEMPLATE\\bug_report.md','.github\\ISSUE_TEMPLATE\\feature_request.md','PROGRESS.md','FINAL_STATUS.md','验收说明.md','run_verify.py','syntax_check.py','full_verify.bat','test_run.bat'];miss=[f for f in fs if not Path(f).exists()];print(f'Deliverables: {len(fs)-len(miss)}/{len(fs)} pass');[print(f'  MISS: {m}') for m in miss];sys.exit(len(miss))" >> %LOG% 2>&1
if %errorlevel% neq 0 (echo [FAIL] 交付物缺失 >> %LOG%) else (echo [PASS] 交付物完整 >> %LOG%)

echo [2/4] 导入链检查...
cd backend
python check_imports.py >> ..\%LOG% 2>&1
if %errorlevel% neq 0 (echo [FAIL] 导入链错误 >> ..\%LOG%) else (echo [PASS] 导入链完整 >> ..\%LOG%)
cd ..

echo [3/4] 后端测试 (81+项)...
cd backend
python -m pytest tests/ -x --tb=short -q >> ..\%LOG% 2>&1
if %errorlevel% neq 0 (echo [FAIL] 测试未通过 >> ..\%LOG%) else (echo [PASS] 测试全部通过 >> ..\%LOG%)
cd ..

echo [4/4] 前端构建...
cd frontend
call npx vite build >> ..\%LOG% 2>&1
if %errorlevel% neq 0 (echo [FAIL] 前端构建失败 >> ..\%LOG%) else (echo [PASS] 前端构建成功 >> ..\%LOG%)
cd ..

echo.>> %LOG%
echo ===== 完成 =====>> %LOG%
type %LOG%
echo 结果已保存到 %LOG%
pause
