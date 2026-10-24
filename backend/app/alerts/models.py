"""The alerts table."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base


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
