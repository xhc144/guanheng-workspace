"""离线恢复受控演示数据库。

用法：在后端服务停止后执行：
  python scripts/restore_demo.py demo-YYYYMMDD-HHMMSS.db

仅允许从 backend/.demo/backups 恢复到 backend/.demo/demo.db；不会访问 pms.db
或任何用户业务数据库。
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path

from app.core.config import DEMO_DB_PATH

BACKUP_DIR = (DEMO_DB_PATH.parent / "backups").resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="恢复受控演示数据库")
    parser.add_argument("backup_name", help="备份文件名，仅允许 .demo/backups 下的 .db 文件")
    args = parser.parse_args()

    source = (BACKUP_DIR / args.backup_name).resolve()
    target = DEMO_DB_PATH.resolve()
    if source.parent != BACKUP_DIR or source.suffix != ".db" or not source.exists():
        raise SystemExit("拒绝恢复：备份文件必须位于 backend/.demo/backups 且扩展名为 .db")
    if target.parent != DEMO_DB_PATH.parent.resolve() or target.name != "demo.db":
        raise SystemExit("拒绝恢复：目标不是 backend/.demo/demo.db")

    temp = target.with_suffix(".restore.tmp")
    if temp.exists():
        temp.unlink()
    source_conn = sqlite3.connect(str(source))
    target_conn = sqlite3.connect(str(temp))
    try:
        source_conn.backup(target_conn)
        target_conn.execute("PRAGMA integrity_check").fetchone()
    finally:
        target_conn.close()
        source_conn.close()
    os.replace(temp, target)
    print(f"已恢复受控演示数据库：{target}")


if __name__ == "__main__":
    main()
