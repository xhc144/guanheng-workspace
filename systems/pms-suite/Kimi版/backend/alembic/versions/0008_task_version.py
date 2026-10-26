"""task optimistic-lock version column (guarded)

Revision ID: 0008
Revises: 0007
Create Date: 2025-01-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0008_task_version"
down_revision = "0007_wiki"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "tasks" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("tasks")]
        if "version" not in cols:
            op.add_column("tasks", sa.Column("version", sa.Integer(), server_default="0"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "tasks" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("tasks")]
        if "version" in cols:
            op.drop_column("tasks", "version")
