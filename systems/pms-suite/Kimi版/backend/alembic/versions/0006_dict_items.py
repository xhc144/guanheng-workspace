"""dict_items table

Revision ID: 0006_dict_items
Revises: 0005_documents
Create Date: 2025-01-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_dict_items"
down_revision = "0005_documents"
branch_labels = None
depends_on = None


def upgrade():
    if "dict_items" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "dict_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group", sa.String(50), index=True),
        sa.Column("code", sa.String(50)),
        sa.Column("label", sa.String(100)),
        sa.Column("sort", sa.Integer(), server_default="0"),
        sa.Column("is_active", sa.Boolean(), server_default="1"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), server_default="1"),
        sa.UniqueConstraint("group", "code", name="uq_dict_group_code"),
    )


def downgrade():
    op.drop_table("dict_items")
