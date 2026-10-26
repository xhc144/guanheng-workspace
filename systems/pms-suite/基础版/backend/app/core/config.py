import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEMO_DB_PATH = BACKEND_DIR / ".demo" / "demo.db"
DEMO_DATABASE_URL = f"sqlite:///{DEMO_DB_PATH.as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENVIRONMENT: str = "development"
    APP_NAME: str = "综合项目管理系统"
    SECRET_KEY: str = Field(default="dev-only-secret-change-me-32-bytes", repr=False)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    # 基础版仅使用受控演示库，应用启动时会拒绝其他数据库地址。
    DATABASE_URL: str = DEMO_DATABASE_URL
    ALGORITHM: str = "HS256"
    CORS_ORIGINS: str = "http://127.0.0.1:5180,http://localhost:5180"


    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @model_validator(mode="after")
    def validate_security(self):
        environment = self.ENVIRONMENT.strip().lower()
        self.ENVIRONMENT = "production" if environment == "prod" else environment
        if self.ENVIRONMENT not in {"development", "test", "production"}:
            raise RuntimeError("ENVIRONMENT 仅支持 development、test、production（或 prod）")
        if self.is_production:
            key = self.SECRET_KEY
            configured = next((v for k, v in os.environ.items() if k.upper() == "SECRET_KEY"), None)
            weak = any(word in key.lower() for word in ("secret", "change", "password", "example", "replace", "your-", "your_"))
            repeated = any(key == key[:n] * (len(key) // n) for n in range(1, len(key) // 2 + 1) if len(key) % n == 0)
            if configured != key or len(key) < 32 or len(set(key)) < 12 or any(c.isspace() for c in key) or weak or repeated:
                # RuntimeError 不携带 Pydantic input_value，避免异常回显密钥。
                raise RuntimeError("生产环境必须通过进程环境变量 SECRET_KEY 提供至少32位的随机密钥；拒绝空值、默认值、重复值及占位口令")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
