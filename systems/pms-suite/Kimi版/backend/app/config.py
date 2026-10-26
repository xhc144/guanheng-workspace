import os
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEMO_DB_PATH = (BACKEND_DIR / ".demo" / "demo.db").resolve()


def demo_database_url() -> str:
    """Return the only SQLite URL permitted while DEMO_MODE is enabled."""
    return f"sqlite:///{DEMO_DB_PATH.as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite:///./app.db"
    demo_mode: bool = False
    secret_key: str = Field(default="dev-secret-key", repr=False)
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    admin_username: str = "admin"
    admin_password: str = Field(default="Admin@123456", repr=False)
    cors_origins: str = "http://localhost:5181,http://127.0.0.1:5181"
    storage_dir: str = "./storage"


    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def validate_security(self):
        environment = self.environment.strip().lower()
        self.environment = "production" if environment == "prod" else environment
        if self.environment not in {"development", "test", "production"}:
            raise RuntimeError("ENVIRONMENT 仅支持 development、test、production（或 prod）")
        if self.is_production:
            key = self.secret_key
            configured = next((v for k, v in os.environ.items() if k.upper() == "SECRET_KEY"), None)
            weak = any(word in key.lower() for word in ("secret", "change", "password", "example", "replace", "your-", "your_"))
            repeated = any(key == key[:n] * (len(key) // n) for n in range(1, len(key) // 2 + 1) if len(key) % n == 0)
            if configured != key or len(key) < 32 or len(set(key)) < 12 or any(c.isspace() for c in key) or weak or repeated:
                # RuntimeError 不携带 Pydantic input_value，避免异常回显密钥。
                raise RuntimeError("生产环境必须通过进程环境变量 SECRET_KEY 提供至少32位的随机密钥；拒绝空值、默认值、重复值及占位口令")
            if self.demo_mode:
                raise RuntimeError("生产环境禁止启用 DEMO_MODE，不能自动创建演示账号")
        elif self.admin_username != "admin" or self.admin_password != "Admin@123456":
            raise RuntimeError("本地演示身份固定为 admin；不支持通过 ADMIN_USERNAME 或 ADMIN_PASSWORD 初始化真实账号")
        if self.demo_mode:
            self.require_controlled_demo_database()
        return self

    @property
    def active_database_url(self) -> str:
        # Do not trust a caller-supplied DATABASE_URL during an acceptance run.
        # DEMO_MODE always uses this repository's controlled database.
        return demo_database_url() if self.demo_mode else self.database_url

    def require_controlled_demo_database(self) -> None:
        if self.is_production:
            raise RuntimeError("生产环境禁止播种或重置演示数据")
        if not self.demo_mode:
            raise RuntimeError("演示数据库操作必须设置 DEMO_MODE=1")
        demo_path = BACKEND_DIR / ".demo" / "demo.db"
        if demo_path.is_symlink() or demo_path.parent.is_symlink():
            raise RuntimeError("拒绝访问演示库：backend/.demo 或 demo.db 不能是符号链接")
        if Path(DEMO_DB_PATH).parent != (BACKEND_DIR / ".demo").resolve():
            raise RuntimeError("演示数据库路径超出受控目录")


settings = Settings()
