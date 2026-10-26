"""应用日志配置"""
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging():
    from app.config import settings
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(fmt)

    # File handler (rotating, 10MB max, 3 backups)
    file_handler = RotatingFileHandler(
        log_dir / "app.log", maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(console)
    root.addHandler(file_handler)

    # Mute noisy libraries
    for name in ("uvicorn.access", "sqlalchemy.engine", "passlib", "httpx"):
        logging.getLogger(name).setLevel(logging.WARNING)

    return logging.getLogger("pms")


logger = setup_logging()


def get_logger(name: str = "pms"):
    """获取命名日志器"""
    return logging.getLogger(name)
