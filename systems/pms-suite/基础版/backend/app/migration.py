"""受控数据库迁移入口。

当前代码库从早期 create_all 演示版本演进而来。此模块把 schema 升级限制在
backend/.demo/demo.db 或明确传入的测试 SQLite 文件，避免任何脚本触碰业务库。
"""
from pathlib import Path
from sqlalchemy import create_engine
from . import models  # 导入全部模型以注册元数据
from .core.config import DEMO_DB_PATH, DEMO_DATABASE_URL
from .core.db import Base


def _sqlite_path(url: str) -> Path:
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise RuntimeError("当前迁移入口仅支持 SQLite")
    return Path(url.removeprefix(prefix)).resolve()


def upgrade(url: str = DEMO_DATABASE_URL, allow_test: bool = False) -> Path:
    """创建或升级受控演示/测试库的全部表结构，不会删除表或数据。"""
    path = _sqlite_path(url)
    demo_dir = DEMO_DB_PATH.parent.resolve()
    if path.parent != demo_dir and not (allow_test and "pytest" in str(path.parent).lower()):
        raise RuntimeError("迁移目标必须是受控演示库或 pytest 临时库")
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False})
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    return path
