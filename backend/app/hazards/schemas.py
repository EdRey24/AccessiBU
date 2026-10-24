"""A hazard returned by a later read route."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.hazards.models import HazardStatus


class Hazard(BaseModel):
    """A hazard returned by a later read route.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate.
        longitude: East-west coordinate.
        status: open or resolved.
        created_at: When the hazard was stored.
        severity_score: Passage interference from 0 through 100.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: HazardStatus
    created_at: datetime
    severity_score: int = Field(ge=0, le=100)
