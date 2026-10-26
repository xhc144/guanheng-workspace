"""Stable authentication smoke test with a per-test temporary SQLite database."""
import os
from pathlib import Path

from fastapi.testclient import TestClient

os.environ["DEMO_MODE"] = "0"


def test_admin_login_smoke(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "auth-smoke.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")

    # Application modules cache the engine at import time, so this test stays
    # self-contained by importing only after the temporary URL is selected.
    from app.db import Base, SessionLocal, engine
    from app.main import app, seed_baseline_data

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_baseline_data(db)
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "Admin@123456"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["access_token"]
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        ).status_code == 401
