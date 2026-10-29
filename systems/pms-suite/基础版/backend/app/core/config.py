import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEMO_DB_PATH = BACKEND_DIR / ".demo" / "demo.db"
DEMO_DATABASE_URL = f"sqlite:///{DEMO_DB_PATH.as_posix()}"


def _has_obvious_secret_pattern(value: str) -> bool:
    """只筛除明确的顺序串和常见口令前缀，不能据此证明随机性。"""
    folded = value.casefold()
    streams = (
        "0123456789abcdefghijklmnopqrstuvwxyz",
        "abcdefghijklmnopqrstuvwxyz0123456789",
        "qwertyuiopasdfghjklzxcvbnm0123456789",
    )
    # 连续10位已知顺序及其反向属于明确弱模式；不尝试估算任意串的熵。
    ordered = any(
        stream[start:start + 10] in folded
        for forward in streams
        for stream in (forward, forward[::-1])
        for start in range(len(stream) - 9)
    )
    compact = "".join(char for char in folded if char.isascii() and char.isalnum())
    common_prefix = compact.startswith((
        "admin123456", "admin123", "qwerty", "letmein", "welcome",
        "iloveyou", "abc123", "123456", "passw0rd", "pssw0rd",
    ))
    return ordered or common_prefix


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
            if configured != key or len(key) < 32 or len(set(key)) < 12 or any(c.isspace() for c in key) or weak or repeated or _has_obvious_secret_pattern(key):
                # RuntimeError 不携带 Pydantic input_value，避免异常回显密钥。
                raise RuntimeError("生产环境必须通过进程环境变量 SECRET_KEY 提供至少32位的随机密钥；拒绝空值、默认值、重复值、顺序串及常见占位口令")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
