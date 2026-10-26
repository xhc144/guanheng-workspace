"""approvals table

Revision ID: 0002_approvals
Revises: 0001_initial
Create Date: 2025-01-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_approvals"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "approvals" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "approvals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(30), index=True),
        sa.Column("object_type", sa.String(50), nullable=True),
        sa.Column("object_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(200)),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("submitter_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("approver_ids", sa.String(200)),
        sa.Column("current_step", sa.Integer(), server_default="0"),
        sa.Column("status", sa.String(20), server_default="待审批"),
        sa.Column("cc_ids", sa.String(200), nullable=True),
        sa.Column("idempotency_key", sa.String(100), unique=True, nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), server_default="1"),
    )


def downgrade():
    op.drop_table("approvals")
