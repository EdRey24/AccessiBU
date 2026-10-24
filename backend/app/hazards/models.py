"""The hazards table.

Severity is stored only on a hazard. A photo score will be copied from
classification output, and a text submission will supply its score
directly. Report rows do not keep a copy.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, Integer, func
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
        value_enum(HazardStatus, "ck_hazards_status"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    severity_score: Mapped[int] = mapped_column(Integer)
