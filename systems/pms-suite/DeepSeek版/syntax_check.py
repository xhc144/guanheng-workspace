#!/usr/bin/env python3
"""语法检查: 验证所有Python文件无语法错误 — 无需bash/导入"""
import sys, os, ast
from pathlib import Path

ROOT = Path(__file__).parent
errors = []
checked = 0

for py_file in sorted((ROOT / "backend").rglob("*.py")):
    if "__pycache__" in str(py_file):
        continue
    try:
        ast.parse(py_file.read_text(encoding="utf-8"))
        checked += 1
    except SyntaxError as e:
        errors.append(f"{py_file.relative_to(ROOT)}: line {e.lineno}: {e.msg}")

print(f"检查: {checked}文件, 错误: {len(errors)}")
for e in errors:
    print(f"  FAIL {e}")

sys.exit(len(errors))
