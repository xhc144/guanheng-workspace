"""应用配置"""
import os
from pathlib import Path
from typing import List

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEMO_DATABASE_PATH = (BACKEND_DIR / ".demo" / "demo.db").resolve()


class Settings(BaseSettings):
    SECRET_KEY: str = Field(default="dev-secret-key-change-in-production", repr=False)
    DATABASE_URL: str = "sqlite:///./pms.db"
    DEMO_MODE: bool = False
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5182", "http://127.0.0.1:5182",
    ]
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": "../.env", "env_file_encoding": "utf-8"}


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
            if self.DEMO_MODE:
                raise RuntimeError("生产环境禁止启用 DEMO_MODE，不能自动创建演示账号")
        return self


settings = Settings()


def validate_demo_database_url(database_url: str) -> None:
    """Ensure demo mode can never point at a normal application database."""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise RuntimeError("DEMO_MODE 只允许使用受控 SQLite 演示库")
    database_path = Path(database_url.removeprefix(prefix))
    if not database_path.is_absolute():
        database_path = (Path.cwd() / database_path).resolve()
    if database_path != DEMO_DATABASE_PATH:
        raise RuntimeError("DEMO_MODE 只允许使用 backend/.demo/demo.db")


if settings.DEMO_MODE:
    validate_demo_database_url(settings.DATABASE_URL)
