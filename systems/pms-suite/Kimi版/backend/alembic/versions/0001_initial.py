"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01
"""
import os
import sys

from alembic import op

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from app.db import Base  # noqa: E402
from app import models  # noqa: F401,E402

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(bind=op.get_bind())


def downgrade():
    Base.metadata.drop_all(bind=op.get_bind())
