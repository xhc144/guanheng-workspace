"""数据库引擎与会话管理"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool
from app.config import settings

# SQLite 外键支持
_is_sqlite = "sqlite" in settings.DATABASE_URL
is_sqlite = _is_sqlite  # public alias
engine_options = {
    "connect_args": {"check_same_thread": False} if _is_sqlite else {},
    "echo": False,
}
if _is_sqlite:
    engine_options["poolclass"] = NullPool
else:
    engine_options.update(
        pool_pre_ping=True,
        pool_recycle=3600,
        pool_size=5,
        max_overflow=10,
    )
engine = create_engine(settings.DATABASE_URL, **engine_options)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """启用 SQLite 外键约束"""
    if "sqlite" in settings.DATABASE_URL:
        import sqlite3
        if isinstance(dbapi_connection, sqlite3.Connection):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


def ensure_schema_columns():
    """为既有数据库补齐新增列（create_all 不会修改已存在的表）。

    幂等：仅对缺少的列执行 ALTER TABLE，适用于 SQLite 开发库。
    """
    if not _is_sqlite:
        return
    import sqlite3
    from sqlalchemy import text
    # 表名 -> 缺列时补充的列定义
    extra_columns = {
        "tasks": [("start_date", "DATETIME")],
    }
    with engine.connect() as conn:
        for table, columns in extra_columns.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for col_name, col_type in columns:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
        conn.commit()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
