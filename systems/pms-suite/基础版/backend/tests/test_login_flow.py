"""全新合成演示库登录与重启回归，不复用开发库。"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

BACKEND = Path(__file__).resolve().parents[1]


def test_health_and_login_flow(tmp_path):
    isolated = tmp_path / 'backend'
    shutil.copytree(BACKEND, isolated, ignore=shutil.ignore_patterns(
        '.env*', '.demo', '*.db*', '.venv', '__pycache__', '.pytest_cache', 'logs', 'storage'))
    env = {k: v for k, v in os.environ.items() if k.upper() not in {
        'DATABASE_URL', 'ENVIRONMENT', 'SECRET_KEY', 'DEMO_MODE'}}
    env.update(PYTHONPATH=str(isolated), ENVIRONMENT='test')
    code = '''
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.demo import seed_demo_database
from app.models import User

with TestClient(app) as client:
    health = client.get('/api/health')
    assert health.status_code == 200
    assert health.json() == {'status': 'ok'}
    paths = app.openapi()['paths']
    assert '/api/auth/login' in paths
    assert '/api/v1/auth/login' not in paths
    assert client.get('/api/auth/me').status_code == 401
    rejected = client.post('/api/auth/login', json={'username': 'admin', 'password': 'wrong'})
    assert rejected.status_code == 401
    assert rejected.json()['detail'] == '用户名或密码错误'
    login = client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'})
    assert login.status_code == 200, login.text
    token = login.json()['access_token']
    me = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
    assert me.status_code == 200
    assert me.json()['username'] == 'admin'
    logout = client.post('/api/auth/logout', headers={'Authorization': f'Bearer {token}'})
    assert logout.status_code == 200
    assert logout.json() == {'ok': True}
    with SessionLocal() as db:
        user = db.query(User).filter_by(username='admin').one()
        user.password_hash = hash_password('SyntheticChanged@234')
        db.commit()
        preserved = user.password_hash
        count = db.query(User).count()

seed_demo_database()
with TestClient(app) as client:
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'admin', 'password': 'SyntheticChanged@234'}).status_code == 200
    with SessionLocal() as db:
        assert db.query(User).filter_by(username='admin').one().password_hash == preserved
        assert db.query(User).count() == count
print('基础版：新库登录、拒绝错误口令、重启保留密码通过')
'''
    result = subprocess.run([sys.executable, '-c', code], cwd=isolated, env=env,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '重启保留密码通过' in result.stdout
