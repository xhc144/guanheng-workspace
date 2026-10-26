#!/usr/bin/env python3
"""一键验证入口: python run_verify.py — 执行 verify_goal.py 并输出结果"""
import subprocess, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print("=" * 60)
print("综合项目管理系统 — 一键验证")
print(f"工作目录: {os.getcwd()}")
print("=" * 60)

result = subprocess.run([sys.executable, "verify_goal.py"], check=False)
if result.returncode != 0:
    print("\n尝试逐模块诊断...")
    subprocess.run([sys.executable, "syntax_check.py"], check=False)
    subprocess.run([sys.executable, "self_check.py"], check=False)
    subprocess.run([sys.executable, "backend/check_imports.py"], check=False)
print("=" * 60)
print(f"验证 {'通过 [OK]' if result.returncode == 0 else '未通过 [X]'} (exit code: {result.returncode})")
print("=" * 60)
sys.exit(result.returncode)
