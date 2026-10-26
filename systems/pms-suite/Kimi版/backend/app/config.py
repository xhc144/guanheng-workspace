from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEMO_DB_PATH = (BACKEND_DIR / ".demo" / "demo.db").resolve()


def demo_database_url() -> str:
    """Return the only SQLite URL permitted while DEMO_MODE is enabled."""
    return f"sqlite:///{DEMO_DB_PATH.as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./app.db"
    demo_mode: bool = False
    secret_key: str = "dev-secret-key"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    admin_username: str = "admin"
    admin_password: str = "Admin@123456"
    cors_origins: str = "http://localhost:5181,http://127.0.0.1:5181"
    storage_dir: str = "./storage"

    @property
    def active_database_url(self) -> str:
        # Do not trust a caller-supplied DATABASE_URL during an acceptance run.
        # DEMO_MODE always uses this repository's controlled database.
        return demo_database_url() if self.demo_mode else self.database_url

    def require_controlled_demo_database(self) -> None:
        if not self.demo_mode:
            raise RuntimeError("DEMO_MODE=1 is required for demo database operations")
        if Path(DEMO_DB_PATH).parent != (BACKEND_DIR / ".demo").resolve():
            raise RuntimeError("demo database path is outside the controlled directory")


settings = Settings()
