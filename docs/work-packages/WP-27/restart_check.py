"""Real local HTTP / process restart check; never opens an existing data file."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

backend = Path(os.environ.get('WP27_BACKEND', '/tmp/guanheng-WP-27-deepseek/backend')).resolve()
assert backend.is_relative_to(Path('/tmp')), 'Use a copied backend under /tmp'
assert (backend / 'app/main.py').is_file()
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
base = f'http://127.0.0.1:{port}/api'


def request(path, method='GET', body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    payload = json.dumps(body).encode() if body is not None else None
    try:
        with urlopen(Request(base + path, data=payload, headers=headers, method=method), timeout=10) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        raise AssertionError(f'Unexpected HTTP {error.code} on {method} {path}') from None


with tempfile.TemporaryDirectory(prefix='guanheng-wp27-restart-') as directory:
    environment = os.environ.copy()
    environment.update(DATABASE_URL=f'sqlite:///{directory}/synthetic.db', ENVIRONMENT='test', DEMO_MODE='false')
    process = None
    with (Path(directory) / 'server.log').open('w') as log:
        def start():
            global process
            process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)],
                                       cwd=backend, env=environment, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, 'The isolated server exited during startup'
                try:
                    status, health = request('/health')
                    if status == 200 and health['status'] == 'ok':
                        return
                except (URLError, TimeoutError):
                    pass
                time.sleep(0.1)
            raise AssertionError('The isolated server did not become ready')

        def stop():
            global process
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                process = None

        def login():
            return request('/auth/login', 'POST', {'username': 'admin', 'password': 'Admin@123456'})[1]['access_token']

        try:
            start()
            token = login()
            suffix = uuid4().hex
            customer = request('/customers', 'POST', {'name': '虚构重启检查客户'}, token)[1]
            project = request('/projects', 'POST', {
                'code': f'RESTART-{suffix}', 'name': '虚构重启检查项目', 'customer_id': customer['id'], 'manager_id': 'u001',
            }, token)[1]
            assert request('/contracts', 'POST', {
                'code': f'CT-{suffix}', 'name': '虚构重启合同', 'project_id': project['id'], 'amount': '100.00',
            }, token)[0] == 200
            body = {'project_id': project['id'], 'amount': '25.25', 'received_date': '2026-01-15T00:00:00', 'idempotency_key': suffix}
            status, receipt = request('/finance/receipts', 'POST', body, token)
            assert status == 201
            receipt_id = receipt['id']
            assert request(f'/receipts/{receipt_id}/confirm', 'PUT', token=token)[0] == 200
            stats_path = f"/receipts/project/{project['id']}/stats"
            assert request(stats_path, token=token)[1]['total_received'] == 25.25
            stop()
            start()
            token = login()
            status, replay = request('/finance/receipts', 'POST', body, token)
            assert status == 200 and replay['id'] == receipt_id and replay['status'] == 'confirmed'
            assert request(stats_path, token=token)[1]['total_received'] == 25.25
            assert request(f'/receipts/{receipt_id}/reverse', 'PUT', token=token)[0] == 200
            stop()
            start()
            token = login()
            status, replay = request('/finance/receipts', 'POST', body, token)
            assert status == 200 and replay['id'] == receipt_id and replay['status'] == 'reversed'
            assert request(stats_path, token=token)[1]['total_received'] == 0
            receipts = request(f"/finance/receipts?project_id={project['id']}", token=token)[1]
            assert len(receipts) == 1
            audits = [row['action'] for row in request('/audit-logs', token=token)[1] if row['target_id'] == receipt_id]
            assert sorted(audits) == ['confirm', 'create', 'reverse']
            print(json.dumps({'process_restarts': 2, 'receipt_rows': 1, 'create_audits': 1,
                              'amount': '25.25', 'final_status': 'reversed', 'final_received': 0,
                              'database': 'fresh temporary synthetic SQLite', 'result': 'passed'}, indent=2))
        finally:
            stop()
