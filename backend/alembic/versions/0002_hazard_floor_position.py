"""Add floor and plan-position to hazards.

Revision ID: 0002_hazard_floor_position
Revises: 0001_initial
Create Date: 2026-10-24

A hazard is now located not only by latitude/longitude but by the floor
it sits on and the normalized pin position (x, y in 0..1) on that
floor's plan image. These come from the pin the reporter drops, so the
same point can be redrawn on the correct floor for every device. All
three are nullable: an outside hazard (or one opened without a plan pin)
has no floor or position.
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_hazard_floor_position"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Adds nullable floor and position columns to hazards."""
    op.add_column("hazards", sa.Column("floor", sa.Integer(), nullable=True))
    op.add_column("hazards", sa.Column("position_x", sa.Float(), nullable=True))
    op.add_column("hazards", sa.Column("position_y", sa.Float(), nullable=True))
    # A position is a point: both coordinates are present, or neither is.
    op.create_check_constraint(
        "ck_hazards_position_pair",
        "hazards",
        "(position_x IS NULL) = (position_y IS NULL)",
    )
    # Normalized plan coordinates stay within the image (0..1).
    op.create_check_constraint(
        "ck_hazards_position_range",
        "hazards",
        "(position_x IS NULL OR (position_x BETWEEN 0 AND 1)) "
        "AND (position_y IS NULL OR (position_y BETWEEN 0 AND 1))",
    )


def downgrade() -> None:
    """Drops the floor and position columns from hazards."""
    op.drop_constraint("ck_hazards_position_range", "hazards", type_="check")
    op.drop_constraint("ck_hazards_position_pair", "hazards", type_="check")
    op.drop_column("hazards", "position_y")
    op.drop_column("hazards", "position_x")
    op.drop_column("hazards", "floor")
