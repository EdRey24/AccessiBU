"""A hazard returned by the read routes."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.hazards.models import HazardStatus
from app.reports.models import HazardType


class Hazard(BaseModel):
    """A hazard returned by the read routes.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate.
        longitude: East-west coordinate.
        status: open or resolved.
        created_at: When the hazard was stored.
        severity_score: Passage interference from 0 through 100.
        hazard_type: Kind of condition, from the newest report. None
            when the hazard has no report.
        description: The newest report's text or photo summary. None
            when the hazard has no report.
        report_count: How many reports describe this hazard.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: HazardStatus
    created_at: datetime
    severity_score: int = Field(ge=0, le=100)
    hazard_type: HazardType | None = None
    description: str | None = None
    report_count: int = 0
