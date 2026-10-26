from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEMO_DB_PATH = BACKEND_DIR / ".demo" / "demo.db"
DEMO_DATABASE_URL = f"sqlite:///{DEMO_DB_PATH.as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "综合项目管理系统"
    SECRET_KEY: str = "dev-only-secret-change-me-32-bytes"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    # 基础版仅使用受控演示库，应用启动时会拒绝其他数据库地址。
    DATABASE_URL: str = DEMO_DATABASE_URL
    ALGORITHM: str = "HS256"
    CORS_ORIGINS: str = "http://127.0.0.1:5180,http://localhost:5180"


@lru_cache
def get_settings() -> Settings:
    return Settings()
