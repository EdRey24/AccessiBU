"""The reports table.

A photo row stores an image path and a summary. A text row stores a
description. The other kind's columns stay null.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base, value_enum


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


class Report(Base):
    """One photo or text submission about a hazard.

    Category and hazard type are required on both, which is the finished
    report. An unfinished photo, kept after a failed vision call, needs
    a later migration.

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
        value_enum(ReportKind, "ck_reports_kind"),
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
        value_enum(HazardType, "ck_reports_hazard_type"),
    )
    category: Mapped[int] = mapped_column(Integer)
    image_path: Mapped[str | None] = mapped_column(String(1024))
    summary: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
