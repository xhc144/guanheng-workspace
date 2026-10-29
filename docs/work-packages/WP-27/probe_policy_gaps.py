"""Recheck the original permission gaps using only a disposable synthetic DB.

Run with the DeepSeek backend on PYTHONPATH. Exit 1 means an expected denial
is missing; the initial pre-fix exit 1 remains in the verification history.
"""
import json
import os
import tempfile
from pathlib import Path
from uuid import uuid4

with tempfile.TemporaryDirectory(prefix='guanheng-wp27-policy-') as directory:
    os.environ['DATABASE_URL'] = f"sqlite:///{Path(directory) / 'synthetic.db'}"
    os.environ['ENVIRONMENT'] = 'test'
    os.environ['DEMO_MODE'] = 'false'
    from fastapi.testclient import TestClient
    from app.database import SessionLocal
    from app.main import app
    from app.models import AuditLog, ProjectMember, Receipt

    with TestClient(app, client=('wp27-policy-probe', 50000)) as client:
        admin = client.post('/api/auth/login', json={'username': 'admin', 'password': 'Admin@123456'})
        assert admin.status_code == 200
        admin_headers = {'Authorization': f"Bearer {admin.json()['access_token']}"}
        member = client.post('/api/auth/login', json={'username': 'dev_li', 'password': 'dev123'})
        assert member.status_code == 200
        member_headers = {'Authorization': f"Bearer {member.json()['access_token']}"}
        customer = client.post('/api/customers', headers=admin_headers, json={'name': '虚构权限核对客户'})
        assert customer.status_code == 200
        project = client.post('/api/projects', headers=admin_headers, json={
            'code': f'GAP-{uuid4().hex}', 'name': '虚构未授权项目',
            'customer_id': customer.json()['id'], 'manager_id': 'u001',
        })
        assert project.status_code == 200
        project_id = project.json()['id']
        with SessionLocal() as db:
            assert db.query(ProjectMember).filter_by(project_id=project_id, user_id='u004').count() == 0
        visible = client.get(f'/api/projects/{project_id}', headers=member_headers)
        receipt = client.post('/api/receipts', headers=admin_headers, json={
            'project_id': project_id, 'amount': '25.00', 'received_date': '2026-01-15T00:00:00',
        })
        assert receipt.status_code == 200
        receipt_id = receipt.json()['id']
        assert client.put(f'/api/receipts/{receipt_id}/confirm', headers=admin_headers).status_code == 200
        canonical = client.put(f'/api/receipts/{receipt_id}/reverse', headers=member_headers)
        alias = client.post(f'/api/finance/receipts/{receipt_id}/write-off', headers=member_headers,
                            json={'reason': '虚构权限缺口复现'})
        with SessionLocal() as db:
            receipt_status = db.get(Receipt, receipt_id).status
            audit_count = db.query(AuditLog).filter_by(target_type='receipt', target_id=receipt_id, action='write_off').count()
        complete = (canonical.status_code == 403 and alias.status_code == 403
                    and visible.status_code in (403, 404)
                    and receipt_status == 'confirmed' and audit_count == 0)
        result = {
            'canonical_reverse_member_status': canonical.status_code,
            'alias_write_off_member_status': alias.status_code,
            'alias_expected_status': 403,
            'receipt_after_alias': receipt_status,
            'write_off_audit_count': audit_count,
            'unrelated_project_member_status': visible.status_code,
            'unrelated_project_expected_denial': [403, 404],
            'fixed_in_wp27': complete,
            'reason': '按根续接授权接回已有财务动作门槛与项目范围；全局角色语义不变，拒绝后记录和审计均不变',
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if complete else 1)
