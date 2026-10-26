"""budgets & costs

Revision ID: 0004_budget_cost
Revises: 0003_timesheets
Create Date: 2025-01-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_budget_cost"
down_revision = "0003_timesheets"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "budgets" not in existing:
        op.create_table(
            "budgets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), index=True),
            sa.Column("category", sa.String(50)),
            sa.Column("amount", sa.Numeric(18, 2)),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("version", sa.Integer(), server_default="1"),
        )
    if "costs" not in existing:
        op.create_table(
            "costs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), index=True),
            sa.Column("budget_id", sa.Integer(), sa.ForeignKey("budgets.id"), nullable=True),
            sa.Column("category", sa.String(50)),
            sa.Column("amount", sa.Numeric(18, 2)),
            sa.Column("cost_date", sa.Date()),
            sa.Column("remark", sa.String(300), nullable=True),
            sa.Column("idempotency_key", sa.String(100), unique=True, nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("version", sa.Integer(), server_default="1"),
        )


def downgrade():
    op.drop_table("costs")
    op.drop_table("budgets")
