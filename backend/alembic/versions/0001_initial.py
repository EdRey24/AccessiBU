"""Create members, hazards, reports, and alerts.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-24

Members point at Supabase auth users. A trigger inserts the member and
another rejects a later email change. Row-level security is on with no
policies for the anon or authenticated roles. The hazard-images bucket
is public.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

_TABLES = ("members", "hazards", "reports", "alerts")


def upgrade() -> None:
    """Creates the initial AccessiBU tables and auth triggers."""
    op.create_table(
        "members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["id"],
            ["auth.users.id"],
            name="fk_members_auth_user",
            ondelete="RESTRICT",
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
    op.execute(_INSERT_MEMBER_FUNCTION)
    op.execute(_INSERT_MEMBER_TRIGGER)
    op.execute(_LOCK_EMAIL_FUNCTION)
    op.execute(_LOCK_EMAIL_TRIGGER)
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM anon, authenticated")
    op.execute(_PUBLIC_BUCKET)


def downgrade() -> None:
    """Drops the auth triggers, bucket, and initial tables."""
    op.execute("DROP TRIGGER IF EXISTS members_insert_from_auth ON auth.users")
    op.execute("DROP TRIGGER IF EXISTS members_lock_auth_email ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS insert_member_from_auth()")
    op.execute("DROP FUNCTION IF EXISTS reject_auth_email_change()")
    op.execute("DELETE FROM storage.objects WHERE bucket_id = 'hazard-images'")
    op.execute("DELETE FROM storage.buckets WHERE id = 'hazard-images'")
    op.drop_table("alerts")
    op.drop_index("ix_reports_member_id", table_name="reports")
    op.drop_index("ix_reports_hazard_id", table_name="reports")
    op.drop_table("reports")
    op.drop_table("hazards")
    op.drop_table("members")


_INSERT_MEMBER_FUNCTION = """
CREATE FUNCTION insert_member_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.members (
        id, email, role, mobility_preference
    )
    VALUES (NEW.id, lower(NEW.email), 'member', false);
    RETURN NEW;
END;
$$
"""

_INSERT_MEMBER_TRIGGER = """
CREATE TRIGGER members_insert_from_auth
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION insert_member_from_auth()
"""

_LOCK_EMAIL_FUNCTION = """
CREATE FUNCTION reject_auth_email_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'member address cannot change';
    END IF;
    RETURN NEW;
END;
$$
"""

_LOCK_EMAIL_TRIGGER = """
CREATE TRIGGER members_lock_auth_email
BEFORE UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION reject_auth_email_change()
"""

_PUBLIC_BUCKET = """
INSERT INTO storage.buckets (id, name, public)
VALUES ('hazard-images', 'hazard-images', true)
"""
