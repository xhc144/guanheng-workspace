"""真实子进程验证生产配置；临时密钥不写入日志或源码。"""
import os
from pathlib import Path
import secrets
import subprocess
import sys

import pytest

BACKEND = Path(__file__).resolve().parents[1]
CONFIG_MODULE = 'app.config'
SECRET_FIELD = 'SECRET_KEY'
DEFAULT_KEY = 'dev-secret-key-change-in-production'


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


def test_production_demo_mode_refused(tmp_path):
    key = secrets.token_hex(32)
    result = launch("import app.main", tmp_path, key=key, demo="1")
    assert result.returncode != 0
    assert "生产环境禁止启用 DEMO_MODE" in result.stderr
    assert key not in result.stdout + result.stderr
    assert not (tmp_path / "synthetic.db").exists()


def test_production_startup_does_not_create_database(tmp_path):
    key = secrets.token_hex(32)
    code = "from fastapi.testclient import TestClient; from app.main import app; "
    code += "\nwith TestClient(app) as client:\n    assert client.get('/api/health').status_code == 200\nprint('生产启动未播种')"
    result = launch(code, tmp_path, key=key)
    assert result.returncode == 0, result.stderr
    assert "生产启动未播种" in result.stdout
    assert key not in result.stdout + result.stderr
    assert not (tmp_path / "synthetic.db").exists()


def test_fresh_demo_login_and_all_seed_entrypoints_preserve_password(tmp_path):
    import shutil
    isolated = tmp_path / 'backend'
    shutil.copytree(BACKEND, isolated, ignore=shutil.ignore_patterns(
        '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    demo_db = isolated / '.demo/demo.db'
    code = '''
from fastapi.testclient import TestClient
from app.main import app, _seed_data
from app.seeder import seed_demo_database
from app.database import SessionLocal
from app.models import User
from app.auth import hash_password

seed_demo_database()
with TestClient(app) as client:
    paths = app.openapi()['paths']
    assert '/api/auth/login' in paths
    assert '/api/v1/auth/login' not in paths
    assert client.get('/api/auth/me').status_code == 401
    rejected = client.post('/api/auth/login', json={'username': 'admin', 'password': 'wrong'})
    assert rejected.status_code == 401
    assert rejected.json()['detail'] == '用户名或密码错误'
    login = client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'})
    assert login.status_code == 200, login.text
    assert login.json()['user']['username'] == 'admin'
    me = client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + login.json()['access_token']})
    assert me.status_code == 200
    assert me.json()['username'] == 'admin'
    with SessionLocal() as db:
        admin = db.query(User).filter_by(username='admin').one()
        admin.hashed_password = hash_password('SyntheticChanged@234')
        db.commit()
        preserved = admin.hashed_password
        count = db.query(User).count()
seed_demo_database()
_seed_data()
with TestClient(app) as client:
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'SyntheticChanged@234'}).status_code == 200
    with SessionLocal() as db:
        assert db.query(User).filter_by(username='admin').one().hashed_password == preserved
        assert db.query(User).count() == count
print('DeepSeek：新库登录、两个播种入口、重启保留密码通过')
'''
    result = launch(code, isolated, mode='test', demo='1', extra={
        'PYTHONPATH': str(isolated), 'DATABASE_URL': f'sqlite:///{demo_db.as_posix()}'})
    assert result.returncode == 0, result.stdout + result.stderr
    assert '重启保留密码通过' in result.stdout


def test_production_seeder_refused_without_database_write(tmp_path):
    key = secrets.token_hex(32)
    for code in ['from app.seeder import seed_demo_database; seed_demo_database()',
                 'from app.main import _seed_data; _seed_data()']:
        result = launch(code, tmp_path, key=key)
        assert result.returncode != 0
        assert '生产模式禁止播种演示数据' in result.stderr
        assert key not in result.stdout + result.stderr
        assert not (tmp_path / 'synthetic.db').exists()


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
    result = launch('import app.config', isolated, mode='test', demo='1', extra={
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
    assert startup.returncode == 0, startup.stderr
    assert key not in startup.stdout + startup.stderr
    assert database.read_bytes() == before
    seeding = launch('from app.seeder import seed_demo_database; seed_demo_database()', tmp_path, key=key)
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
from app.database import SessionLocal
from app.auth import hash_password
from app.models import User
with TestClient(app):
    with SessionLocal() as db:
        user = db.query(User).filter_by(username='admin').one()
        user.hashed_password = hash_password('SyntheticProcessRestart@234')
        db.commit()
        Path('expected-hash.txt').write_text(user.hashed_password)
print('第一次启动已修改合成密码')
"""
    first = launch(first_code, isolated, mode='test', demo='1', extra=extra)
    assert first.returncode == 0, first.stdout + first.stderr
    second_code = """
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.auth import hash_password
from app.models import User
with TestClient(app) as client:
    with SessionLocal() as db:
        assert db.query(User).filter_by(username='admin').one().hashed_password == Path('expected-hash.txt').read_text()
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'SyntheticProcessRestart@234'}).status_code == 200
print('跨进程重启保留密码通过')
"""
    second = launch(second_code, isolated, mode='test', demo='1', extra=extra)
    assert second.returncode == 0, second.stdout + second.stderr
    assert '跨进程重启保留密码通过' in second.stdout
