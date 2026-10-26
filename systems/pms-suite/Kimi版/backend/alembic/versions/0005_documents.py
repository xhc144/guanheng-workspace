"""documents table

Revision ID: 0005_documents
Revises: 0004_budget_cost
Create Date: 2025-01-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_documents"
down_revision = "0004_budget_cost"
branch_labels = None
depends_on = None


def upgrade():
    if "documents" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), index=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("filename", sa.String(255)),
        sa.Column("stored_path", sa.String(500)),
        sa.Column("size", sa.Integer(), server_default="0"),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("uploader_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), server_default="1"),
    )


def downgrade():
    op.drop_table("documents")
