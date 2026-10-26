from fastapi.testclient import TestClient

from app.main import app


def test_health_and_login_flow():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok"}

        rejected = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert rejected.status_code == 401

        login = client.post("/api/auth/login", json={"username": "admin", "password": "Admin@123456"})
        assert login.status_code == 200
        token = login.json()["access_token"]

        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == "admin"

        logout = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert logout.status_code == 200
        assert logout.json() == {"ok": True}
