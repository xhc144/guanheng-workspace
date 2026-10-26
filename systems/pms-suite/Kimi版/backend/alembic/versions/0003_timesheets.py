"""timesheets table

Revision ID: 0003_timesheets
Revises: 0002_approvals
Create Date: 2025-01-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_timesheets"
down_revision = "0002_approvals"
branch_labels = None
depends_on = None


def upgrade():
    if "timesheets" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "timesheets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), index=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("work_date", sa.Date()),
        sa.Column("hours", sa.Numeric(5, 2)),
        sa.Column("content", sa.String(300), nullable=True),
        sa.Column("status", sa.String(20), server_default="草稿"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), server_default="1"),
    )


def downgrade():
    op.drop_table("timesheets")
