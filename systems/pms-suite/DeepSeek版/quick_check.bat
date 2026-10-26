@echo off
chcp 65001 >nul
title PMS 快速检查
echo ====================================
echo  综合项目管理系统 - 快速存在性检查
echo ====================================
echo.
set fail=0

for %%f in (
    "backend\app\main.py" "backend\app\models\__init__.py" "backend\app\schemas.py"
    "backend\app\routes\auth.py" "backend\app\routes\approval.py"
    "backend\tests\test_core.py" "backend\requirements.txt"
    "frontend\src\main.tsx" "frontend\src\App.tsx" "frontend\package.json"
    "verify_goal.py" "verify_goal.ps1" "full_verify.bat"
    "start.bat" "README.md" "QUICKSTART.md" "验收面板.html"
) do (
    if exist %%f (
        echo  [√] %%f
    ) else (
        echo  [×] %%f  -- 缺失!
        set /a fail+=1
    )
)

echo.
if %fail%==0 (
    echo === 全部 %fail% 缺失，核心文件完整 ===
    echo 运行: python run_verify.py
) else (
    echo === %fail% 个文件缺失 ===
)
pause
