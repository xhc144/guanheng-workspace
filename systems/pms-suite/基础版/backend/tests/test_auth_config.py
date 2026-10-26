"""真实子进程验证生产配置；临时密钥不写入日志或源码。"""
import os
from pathlib import Path
import secrets
import subprocess
import sys

import pytest

BACKEND = Path(__file__).resolve().parents[1]
CONFIG_MODULE = 'app.core.config'
SECRET_FIELD = 'SECRET_KEY'
DEFAULT_KEY = 'dev-only-secret-change-me-32-bytes'


def launch(code, cwd, *, mode="production", key=None, demo="0", extra=None):
    env = {k: v for k, v in os.environ.items() if k.upper() not in {
        "SECRET_KEY", "ENVIRONMENT", "DEMO_MODE", "DATABASE_URL", "ADMIN_USERNAME", "ADMIN_PASSWORD"}}
    env.update(PYTHONPATH=str(BACKEND), ENVIRONMENT=mode, DEMO_MODE=demo,
               DATABASE_URL=f"sqlite:///{(cwd / 'synthetic.db').as_posix()}")
    if key is not None:
        env["SECRET_KEY"] = key
    if extra:
        env.update(extra)
    return subprocess.run([sys.executable, "-c", code], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=60)


@pytest.mark.parametrize("key", [None, "", "   ", DEFAULT_KEY, "short", "a" * 64,
                                     "0123456789abcdef" * 4, "change-me-to-a-random-production-secret"])
def test_production_refuses_missing_empty_default_and_weak_keys(tmp_path, key):
    result = launch("import app.main", tmp_path, key=key)
    assert result.returncode != 0
    assert "生产环境必须通过进程环境变量 SECRET_KEY" in result.stderr
    assert not (tmp_path / "synthetic.db").exists()
    if key and key.strip():
        assert key not in result.stdout + result.stderr


@pytest.mark.parametrize("mode", ["production", " Production ", "PROD"])
def test_valid_runtime_key_loads_without_disclosure(tmp_path, mode):
    key = secrets.token_hex(32)
    result = launch(f"from {CONFIG_MODULE} import Settings; s=Settings(_env_file=None); "
                    f"assert s.is_production; assert s.{SECRET_FIELD} == __import__('os').environ['SECRET_KEY']; "
                    f"assert s.{SECRET_FIELD} not in repr(s); print('配置正常')", tmp_path, mode=mode, key=key)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "配置正常"
    assert key not in result.stdout + result.stderr


def test_unknown_environment_refused(tmp_path):
    result = launch(f"from {CONFIG_MODULE} import Settings; Settings(_env_file=None)", tmp_path, mode="productoin", key=secrets.token_hex(32))
    assert result.returncode != 0
    assert "ENVIRONMENT 仅支持" in result.stderr


def test_file_only_key_and_explicit_override_refused(tmp_path):
    # 合成文件没有 .env 名称，不会读取任何现存配置。
    key = secrets.token_hex(32)
    fixture = tmp_path / "synthetic-config.txt"
    fixture.write_text("SECRET_KEY=" + key + "\n")
    result = launch(f"from {CONFIG_MODULE} import Settings; "
                    "__import__('os').environ['ENVIRONMENT']='production'; "
                    "Settings(_env_file='synthetic-config.txt')", tmp_path, mode="test")
    assert result.returncode != 0
    assert "生产环境必须通过进程环境变量 SECRET_KEY" in result.stderr
    assert key not in result.stdout + result.stderr
    result = launch(f"from {CONFIG_MODULE} import Settings; Settings(_env_file=None, {SECRET_FIELD}='x'*64)",
                    tmp_path, key=key)
    assert result.returncode != 0
    assert key not in result.stdout + result.stderr


def test_basic_production_rejects_demo_startup_and_reset(tmp_path):
    key = secrets.token_hex(32)
    for command in ["from fastapi.testclient import TestClient; from app.main import app; \nwith TestClient(app): pass",
                    "from app.demo import reset_demo_database; reset_demo_database()"]:
        result = launch(command, tmp_path, key=key)
        assert result.returncode != 0
        assert "生产模式禁止启动演示库" in result.stderr
        assert key not in result.stdout + result.stderr
        assert not (tmp_path / "synthetic.db").exists()


@pytest.mark.parametrize('link_kind', ['directory', 'database'])
def test_demo_symlink_refused_without_touching_external_file(tmp_path, link_kind):
    import shutil
    isolated = tmp_path / 'backend'
    shutil.copytree(BACKEND, isolated, ignore=shutil.ignore_patterns(
        '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    external = tmp_path / 'external-synthetic'
    external.mkdir()
    sentinel = external / 'demo.db'
    sentinel.write_text('合成外部库，禁止覆盖')
    if link_kind == 'directory':
        (isolated / '.demo').symlink_to(external, target_is_directory=True)
    else:
        (isolated / '.demo').mkdir()
        (isolated / '.demo/demo.db').symlink_to(sentinel)
    result = launch('from app.demo import seed_demo_database; seed_demo_database()', isolated, mode='test', demo='1', extra={
        'PYTHONPATH': str(isolated),
        'DATABASE_URL': f"sqlite:///{(isolated / '.demo/demo.db').as_posix()}"})
    assert result.returncode != 0
    assert '不能是符号链接' in result.stderr
    assert sentinel.read_text() == '合成外部库，禁止覆盖'


def test_production_existing_synthetic_database_unchanged(tmp_path):
    import sqlite3
    database = tmp_path / 'synthetic.db'
    with sqlite3.connect(database) as connection:
        connection.execute('CREATE TABLE sentinel (value TEXT NOT NULL)')
        connection.execute("INSERT INTO sentinel VALUES ('合成已有库：不得初始化或覆盖')")
    before = database.read_bytes()
    key = secrets.token_hex(32)
    startup = launch("from fastapi.testclient import TestClient; from app.main import app; \nwith TestClient(app) as client: assert client.get('/api/health').status_code == 200", tmp_path, key=key)
    assert startup.returncode != 0, startup.stderr
    assert key not in startup.stdout + startup.stderr
    assert database.read_bytes() == before
    seeding = launch('from app.demo import seed_demo_database; seed_demo_database()', tmp_path, key=key)
    assert seeding.returncode != 0
    assert '生产' in seeding.stderr
    assert key not in seeding.stdout + seeding.stderr
    assert database.read_bytes() == before


def test_actual_process_restart_preserves_changed_password(tmp_path):
    import shutil
    isolated = tmp_path / 'backend'
    shutil.copytree(BACKEND, isolated, ignore=shutil.ignore_patterns(
        '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    extra = {'PYTHONPATH': str(isolated),
             'DATABASE_URL': f"sqlite:///{(isolated / '.demo/demo.db').as_posix()}"}
    first_code = """
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import User
with TestClient(app):
    with SessionLocal() as db:
        user = db.query(User).filter_by(username='admin').one()
        user.password_hash = hash_password('SyntheticProcessRestart@234')
        db.commit()
        Path('expected-hash.txt').write_text(user.password_hash)
print('第一次启动已修改合成密码')
"""
    first = launch(first_code, isolated, mode='test', demo='1', extra=extra)
    assert first.returncode == 0, first.stdout + first.stderr
    second_code = """
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import User
with TestClient(app) as client:
    with SessionLocal() as db:
        assert db.query(User).filter_by(username='admin').one().password_hash == Path('expected-hash.txt').read_text()
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'SyntheticProcessRestart@234'}).status_code == 200
print('跨进程重启保留密码通过')
"""
    second = launch(second_code, isolated, mode='test', demo='1', extra=extra)
    assert second.returncode == 0, second.stdout + second.stderr
    assert '跨进程重启保留密码通过' in second.stdout
