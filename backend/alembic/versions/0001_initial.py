"""Create members, hazards, reports, and alerts.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-24

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Creates the initial AccessiBU tables."""
    op.create_table(
        "members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.String(length=32),
            server_default="member",
            nullable=False,
        ),
        sa.Column(
            "mobility_preference",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "email LIKE '%@bu.edu'",
            name="ck_members_email_domain",
        ),
        sa.CheckConstraint(
            "role IN ('member', 'admin')",
            name="ck_members_role",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "hazards",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("severity_score", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "latitude BETWEEN -90 AND 90",
            name="ck_hazards_latitude",
        ),
        sa.CheckConstraint(
            "longitude BETWEEN -180 AND 180",
            name="ck_hazards_longitude",
        ),
        sa.CheckConstraint(
            "severity_score BETWEEN 0 AND 100",
            name="ck_hazards_severity_score",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'resolved')",
            name="ck_hazards_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("hazard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("hazard_type", sa.String(length=32), nullable=False),
        sa.Column("category", sa.Integer(), nullable=False),
        sa.Column("image_path", sa.String(length=1024), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('photo', 'text')",
            name="ck_reports_kind",
        ),
        sa.CheckConstraint(
            "hazard_type IN ("
            "'spill', 'blockage', 'elevator', 'entrance', "
            "'walking_surface', 'other')",
            name="ck_reports_hazard_type",
        ),
        sa.CheckConstraint(
            "(kind = 'photo' AND image_path IS NOT NULL "
            "AND summary IS NOT NULL AND description IS NULL) OR "
            "(kind = 'text' AND description IS NOT NULL "
            "AND image_path IS NULL AND summary IS NULL)",
            name="ck_reports_kind_columns",
        ),
        sa.ForeignKeyConstraint(["hazard_id"], ["hazards.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reports_hazard_id",
        "reports",
        ["hazard_id"],
    )
    op.create_index(
        "ix_reports_member_id",
        "reports",
        ["member_id"],
    )
    op.create_table(
        "alerts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("hazard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["hazard_id"], ["hazards.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hazard_id"),
    )


def downgrade() -> None:
    """Drops the initial AccessiBU tables."""
    op.drop_table("alerts")
    op.drop_index("ix_reports_member_id", table_name="reports")
    op.drop_index("ix_reports_hazard_id", table_name="reports")
    op.drop_table("reports")
    op.drop_table("hazards")
    op.drop_table("members")
