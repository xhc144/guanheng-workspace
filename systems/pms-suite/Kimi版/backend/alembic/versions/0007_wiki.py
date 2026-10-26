"""wiki pages & history

Revision ID: 0007_wiki
Revises: 0006_dict_items
Create Date: 2025-01-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_wiki"
down_revision = "0006_dict_items"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "wiki_pages" not in existing:
        op.create_table(
            "wiki_pages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), index=True),
            sa.Column("title", sa.String(200)),
            sa.Column("content", sa.Text(), server_default=""),
            sa.Column("editor_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("version", sa.Integer(), server_default="1"),
        )
    if "wiki_history" not in existing:
        op.create_table(
            "wiki_history",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("page_id", sa.Integer(), sa.ForeignKey("wiki_pages.id"), index=True),
            sa.Column("content", sa.Text()),
            sa.Column("editor_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("edited_at", sa.DateTime(), server_default=sa.func.now()),
        )


def downgrade():
    op.drop_table("wiki_history")
    op.drop_table("wiki_pages")
