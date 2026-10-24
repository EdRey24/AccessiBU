"""SQLAlchemy tables for members, hazards, reports, and alerts.

Severity is stored only on a hazard. A photo score will be copied from
classification output, and a text submission will supply its score
directly. Report rows do not keep a copy.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Shared metadata for the API tables."""


class MemberRole(enum.StrEnum):
    """A label on a member. Admin powers are not defined yet."""

    MEMBER = "member"
    ADMIN = "admin"


class HazardStatus(enum.StrEnum):
    """Whether a hazard is still in the way."""

    OPEN = "open"
    RESOLVED = "resolved"


class HazardType(enum.StrEnum):
    """The kind of condition a report describes."""

    SPILL = "spill"
    BLOCKAGE = "blockage"
    ELEVATOR = "elevator"
    ENTRANCE = "entrance"
    WALKING_SURFACE = "walking_surface"
    OTHER = "other"


class ReportKind(enum.StrEnum):
    """Which submission shape a report row stores."""

    PHOTO = "photo"
    TEXT = "text"


def _value_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    """Builds a varchar enum that stores the member value.

    Args:
        enum_cls: The Python enum whose values are persisted.
        name: Identifier for the non-native enum type.

    Returns:
        A non-native SQLAlchemy enum. Values such as "member" are stored,
        rather than the Python member name.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=False,
        length=32,
        values_callable=lambda choices: [choice.value for choice in choices],
    )


class Member(Base):
    """A person with a @bu.edu address who reports and browses hazards.

    Attributes:
        id: Primary key.
        email: Sign-in address. It must end in @bu.edu.
        password_hash: Argon2 hash of the password. Never returned by
            the API.
        role: member or admin. Registration always stores member,
            because admin powers are deferred.
        mobility_preference: Whether the person needs a barrier-free
            path. Unused until routing exists.
    """

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint(
            "email LIKE '%@bu.edu'",
            name="ck_members_email_domain",
        ),
        CheckConstraint(
            "role IN ('member', 'admin')",
            name="ck_members_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[MemberRole] = mapped_column(
        _value_enum(MemberRole, "ck_members_role"),
        default=MemberRole.MEMBER,
        server_default=MemberRole.MEMBER.value,
    )
    mobility_preference: Mapped[bool] = mapped_column(
        default=False,
        server_default=false(),
    )


class Hazard(Base):
    """A real-world condition at one geographic point.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate, from -90 through 90.
        longitude: East-west coordinate, from -180 through 180.
        status: open or resolved. A resolved hazard stays resolved.
        created_at: When the hazard was stored.
        severity_score: How much the condition interferes with passage,
            from 0 through 100. Higher means more blocked.
    """

    __tablename__ = "hazards"
    __table_args__ = (
        CheckConstraint(
            "latitude BETWEEN -90 AND 90",
            name="ck_hazards_latitude",
        ),
        CheckConstraint(
            "longitude BETWEEN -180 AND 180",
            name="ck_hazards_longitude",
        ),
        CheckConstraint(
            "severity_score BETWEEN 0 AND 100",
            name="ck_hazards_severity_score",
        ),
        CheckConstraint(
            "status IN ('open', 'resolved')",
            name="ck_hazards_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    status: Mapped[HazardStatus] = mapped_column(
        _value_enum(HazardStatus, "ck_hazards_status"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    severity_score: Mapped[int] = mapped_column(Integer)


class Report(Base):
    """One photo or text submission about a hazard.

    A photo row stores an image path and a summary. A text row stores a
    description. The other kind's columns stay null. Category and hazard
    type are required on both, which is the finished report. An
    unfinished photo, kept after a failed vision call, needs a later
    migration.

    Attributes:
        id: Primary key.
        kind: photo or text.
        hazard_id: The hazard this submission describes.
        member_id: The member who submitted it.
        created_at: When the report was stored.
        hazard_type: The kind of condition described.
        category: Numeric code alongside the hazard type.
        image_path: Storage key for a photo. Null on a text report.
        summary: Short account of a photo. Null on a text report.
        description: Text the member wrote. Null on a photo report.
    """

    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('photo', 'text')",
            name="ck_reports_kind",
        ),
        CheckConstraint(
            "hazard_type IN ("
            "'spill', 'blockage', 'elevator', 'entrance', "
            "'walking_surface', 'other'"
            ")",
            name="ck_reports_hazard_type",
        ),
        CheckConstraint(
            "("
            "kind = 'photo' AND image_path IS NOT NULL "
            "AND summary IS NOT NULL AND description IS NULL"
            ") OR ("
            "kind = 'text' AND description IS NOT NULL "
            "AND image_path IS NULL AND summary IS NULL"
            ")",
            name="ck_reports_kind_columns",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    kind: Mapped[ReportKind] = mapped_column(
        _value_enum(ReportKind, "ck_reports_kind"),
    )
    hazard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hazards.id"),
        index=True,
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    hazard_type: Mapped[HazardType] = mapped_column(
        _value_enum(HazardType, "ck_reports_hazard_type"),
    )
    category: Mapped[int] = mapped_column(Integer)
    image_path: Mapped[str | None] = mapped_column(String(1024))
    summary: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)


class Alert(Base):
    """The single notice Facilities receives for a new hazard.

    Attributes:
        id: Primary key.
        hazard_id: The hazard this notice is about. One alert per hazard.
        sent_at: When the email was sent. Null until then.
    """

    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    hazard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hazards.id"),
        unique=True,
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# Imported by Alembic so every table is registered on Base.metadata.
TABLES: tuple[type[Any], ...] = (Member, Hazard, Report, Alert)
