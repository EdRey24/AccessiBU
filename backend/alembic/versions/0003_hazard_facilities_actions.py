"""Add resolve and soft-delete columns to hazards.

Revision ID: 0003_hazard_facilities_actions
Revises: 0002_hazard_floor_position
Create Date: 2026-10-24

Facilities can resolve a hazard and delete it. A resolve records when
and by whom. A delete only stamps deleted_at, so no report, alert, or
photo is removed and the hazard can be restored by clearing the column.
All three columns are nullable, so existing rows need no backfill.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_hazard_facilities_actions"
down_revision = "0002_hazard_floor_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Adds nullable resolved and deleted columns to hazards."""
    op.add_column(
        "hazards",
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "hazards",
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "hazards",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_hazards_resolved_by",
        "hazards",
        "members",
        ["resolved_by"],
        ["id"],
    )


def downgrade() -> None:
    """Drops the resolved and deleted columns from hazards."""
    op.drop_constraint("fk_hazards_resolved_by", "hazards", type_="foreignkey")
    op.drop_column("hazards", "deleted_at")
    op.drop_column("hazards", "resolved_by")
    op.drop_column("hazards", "resolved_at")
