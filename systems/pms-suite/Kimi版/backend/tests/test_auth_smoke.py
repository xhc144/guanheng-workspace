"""真实子进程与全新合成数据库，避免模块缓存污染其他测试。"""
import os
from pathlib import Path
import shutil
import subprocess
import sys


def test_admin_login_smoke(tmp_path: Path):
    backend = Path(__file__).resolve().parents[1]
    isolated = tmp_path / 'backend'
    shutil.copytree(backend, isolated, ignore=shutil.ignore_patterns(
        '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    env = {k: v for k, v in os.environ.items() if k.upper() not in {
        'DATABASE_URL', 'ENVIRONMENT', 'SECRET_KEY', 'DEMO_MODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'}}
    env.update(PYTHONPATH=str(isolated), ENVIRONMENT='test', DEMO_MODE='1')
    code = '''
from fastapi.testclient import TestClient
from app.config import DEMO_DB_PATH
from app.db import Base, SessionLocal, engine
from app.main import app, seed_baseline_data, seed_demo_data
from app.models import User
from app.security import hash_password

DEMO_DB_PATH.parent.mkdir(parents=True)
Base.metadata.create_all(bind=engine)
seed_demo_data()
with TestClient(app) as client:
    paths = app.openapi()['paths']
    assert '/api/v1/auth/login' in paths
    assert '/api/auth/login' not in paths
    assert client.get('/api/v1/auth/me').status_code == 401
    rejected = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'wrong-password'})
    assert rejected.status_code == 401
    assert rejected.json()['detail'] == '用户名或密码错误'
    response = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'Admin@123456'})
    assert response.status_code == 200, response.text
    assert response.json()['access_token']
    assert response.json()['user']['username'] == 'admin'
    me = client.get('/api/v1/auth/me', headers={'Authorization': 'Bearer ' + response.json()['access_token']})
    assert me.status_code == 200
    assert me.json()['username'] == 'admin'
    with SessionLocal() as db:
        user = db.query(User).filter_by(username='admin').one()
        user.password_hash = hash_password('SyntheticChanged@234')
        db.commit()
        preserved = user.password_hash
        count = db.query(User).count()
seed_demo_data()
with SessionLocal() as db:
    seed_baseline_data(db)
    db.commit()
    assert db.query(User).filter_by(username='admin').one().password_hash == preserved
    assert db.query(User).count() == count
with TestClient(app) as client:
    assert client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'Admin@123456'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'SyntheticChanged@234'}).status_code == 200
engine.dispose()
print('Kimi：新库登录、两个播种入口、重启保留密码通过')
'''
    result = subprocess.run([sys.executable, '-c', code], cwd=isolated, env=env,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '重启保留密码通过' in result.stdout
