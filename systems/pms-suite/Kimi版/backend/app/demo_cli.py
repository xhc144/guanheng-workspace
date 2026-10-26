"""Explicit baseline-seed command for the controlled acceptance database."""
from __future__ import annotations

import argparse
import sys

from .config import DEMO_DB_PATH, settings
from .main import seed_demo_data


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the controlled PMS demo database")
    parser.add_argument("action", choices=("seed", "verify"))
    args = parser.parse_args()

    try:
        settings.require_controlled_demo_database()
        if args.action == "seed":
            seed_demo_data()
            print(f"Seeded controlled demo database: {DEMO_DB_PATH}")
        else:
            from . import models
            from .db import SessionLocal

            db = SessionLocal()
            try:
                admin = db.query(models.User).filter(models.User.username == settings.admin_username).first()
                if not admin:
                    raise RuntimeError("demo administrator is missing; run demo.ps1 -Action Reset")
            finally:
                db.close()
            print(f"Verified controlled demo database: {DEMO_DB_PATH}")
        return 0
    except Exception as exc:
        print(f"Demo database operation refused: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
