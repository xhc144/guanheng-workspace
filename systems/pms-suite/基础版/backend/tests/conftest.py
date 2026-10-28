"""业务回归在逐用例的源码副本中启动，绝不初始化工作区里的演示库。"""
import importlib
import os
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

BACKEND = Path(__file__).resolve().parents[1]


class AuthHeaders(dict):
    def __repr__(self):
        return "<合成鉴权头已隐藏>"


@pytest.fixture
def isolated_backend(tmp_path, monkeypatch):
    root = tmp_path / "backend"
    shutil.copytree(BACKEND, root, ignore=shutil.ignore_patterns(
        ".env*", ".demo", "*.db*", ".venv", "__pycache__", ".pytest_cache",
        "logs", "storage"))
    # 路径常量由副本的 __file__ 自然产生，不改数据库守卫或依赖注入。
    assert not any(name == "app" or name.startswith("app.") for name in sys.modules)
    monkeypatch.syspath_prepend(str(root))
    monkeypatch.chdir(root)
    for key in list(os.environ):
        if key.upper() in {"DATABASE_URL", "SECRET_KEY", "ENVIRONMENT", "DEMO_MODE"}:
            monkeypatch.delenv(key)
    monkeypatch.setenv("ENVIRONMENT", "test")
    db = None
    try:
        main = importlib.import_module("app.main")
        db = importlib.import_module("app.core.db")
        config = importlib.import_module("app.core.config")
        assert Path(main.__file__).is_relative_to(root)
        assert config.DEMO_DB_PATH == root / ".demo" / "demo.db"
        assert not config.DEMO_DB_PATH.exists()
        yield SimpleNamespace(app=main.app, db=db, root=root, config=config)
    finally:
        if db is not None:
            db.engine.dispose()
        for name in list(sys.modules):
            if name == "app" or name.startswith("app."):
                del sys.modules[name]


@pytest.fixture
def api_session(isolated_backend):
    # TestClient 必须作为上下文使用，真实执行建表与播种生命周期。
    with TestClient(isolated_backend.app) as client:
        result = client.post("/api/auth/login", json={
            "username": "admin", "password": "Admin@123456"})
        assert result.status_code == 200, result.text
        headers = AuthHeaders(Authorization=f"Bearer {result.json()['access_token']}")
        yield client, headers
