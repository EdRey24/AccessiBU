"""Store hazard severity on a 1–10 scale.

Revision ID: 0004_severity_out_of_ten
Revises: 0003_hazard_facilities_actions
Create Date: 2026-10-25

Existing scores were stored from 0 through 100. Divide those by 10
and clamp them before the check constraint shrinks.
"""

from alembic import op

revision = "0004_severity_out_of_ten"
down_revision = "0003_hazard_facilities_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Scales stored scores onto 1 through 10."""
    op.execute(
        """
        UPDATE hazards
        SET severity_score = LEAST(
            10,
            GREATEST(1, ROUND(severity_score / 10.0)::integer)
        )
        """
    )
    op.drop_constraint(
        "ck_hazards_severity_score",
        "hazards",
        type_="check",
    )
    op.create_check_constraint(
        "ck_hazards_severity_score",
        "hazards",
        "severity_score BETWEEN 1 AND 10",
    )


def downgrade() -> None:
    """Restores the 0 through 100 score range."""
    op.drop_constraint(
        "ck_hazards_severity_score",
        "hazards",
        type_="check",
    )
    op.execute("UPDATE hazards SET severity_score = severity_score * 10")
    op.create_check_constraint(
        "ck_hazards_severity_score",
        "hazards",
        "severity_score BETWEEN 0 AND 100",
    )
