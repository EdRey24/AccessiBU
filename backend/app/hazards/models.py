"""The hazards table.

Facilities resolve a hazard, reopen it if that was a mistake, or delete
it. A new report never reopens a resolved hazard. A delete only stamps
deleted_at, so the hazard, its reports, and its photos can be recovered.

Severity is stored only on a hazard. A photo score will be copied from
classification output, and a text submission will supply its score
directly. Report rows do not keep a copy.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base, value_enum


class HazardStatus(enum.StrEnum):
    """Whether a hazard is still in the way."""

    OPEN = "open"
    RESOLVED = "resolved"


class Hazard(Base):
    """A real-world condition at one geographic point.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate, from -90 through 90.
        longitude: East-west coordinate, from -180 through 180.
        status: open or resolved. Reports cannot reopen a resolved
            hazard. Only Facilities can, by reopening it.
        created_at: When the hazard was stored.
        severity_score: How much the condition interferes with passage,
            from 0 through 100. Higher means more blocked.
        resolved_at: When Facilities marked the hazard resolved. Null
            while it is open, including after a reopen.
        resolved_by: The admin who resolved it. Null while it is open.
        deleted_at: When Facilities removed the hazard. A deleted
            hazard is hidden from every route but the row is kept.
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
        CheckConstraint(
            "(position_x IS NULL) = (position_y IS NULL)",
            name="ck_hazards_position_pair",
        ),
        CheckConstraint(
            "(position_x IS NULL OR (position_x BETWEEN 0 AND 1)) "
            "AND (position_y IS NULL OR (position_y BETWEEN 0 AND 1))",
            name="ck_hazards_position_range",
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
    # Floor the hazard sits on and the normalized pin position (0..1) on that
    # floor's plan image, taken from the reporter's dropped pin. Nullable: an
    # outside hazard, or one opened without a plan pin, has neither.
    floor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[HazardStatus] = mapped_column(
        value_enum(HazardStatus, "ck_hazards_status"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    severity_score: Mapped[int] = mapped_column(Integer)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("members.id", name="fk_hazards_resolved_by"),
        nullable=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
