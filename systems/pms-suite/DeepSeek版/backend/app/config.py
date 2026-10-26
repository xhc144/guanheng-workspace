"""应用配置"""
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEMO_DATABASE_PATH = (BACKEND_DIR / ".demo" / "demo.db").resolve()


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
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


settings = Settings()


def validate_demo_database_url(database_url: str) -> None:
    """Ensure demo mode can never point at a normal application database."""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise RuntimeError("DEMO_MODE requires the SQLite demo database")
    database_path = Path(database_url.removeprefix(prefix))
    if not database_path.is_absolute():
        database_path = (Path.cwd() / database_path).resolve()
    if database_path != DEMO_DATABASE_PATH:
        raise RuntimeError(f"DEMO_MODE only permits {DEMO_DATABASE_PATH}")


if settings.DEMO_MODE:
    validate_demo_database_url(settings.DATABASE_URL)

if settings.ENVIRONMENT == "production" and settings.SECRET_KEY == "dev-secret-key-change-in-production":
    import warnings
    warnings.warn("SECURITY: Using default SECRET_KEY in production! Set SECRET_KEY env var.", RuntimeWarning)
