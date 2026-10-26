"""Pytest configuration using an isolated temporary SQLite database."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

TEST_DATABASE = Path(tempfile.gettempdir()) / f"pms_pytest_{os.getpid()}.db"
TEST_DATABASE.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE.as_posix()}"
os.environ.pop("DEMO_MODE", None)

# Ensure backend is on path before application modules are imported by tests.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database():
    """Create seed data only in the per-test-process temporary database."""
    from app.auth import hash_password
    from app.database import Base, SessionLocal, engine
    from app.main import _seed_data
    from app.models import User

    Base.metadata.create_all(bind=engine)
    _seed_data()
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.id == "test_admin").first():
            db.add(User(
                id="test_admin",
                username="test_admin",
                hashed_password=hash_password("Admin@123456"),
                real_name="测试管理员",
                role="super_admin",
            ))
            db.commit()
    finally:
        db.close()
    yield
    engine.dispose()
    TEST_DATABASE.unlink(missing_ok=True)


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"
