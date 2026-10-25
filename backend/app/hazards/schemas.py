"""A hazard returned by a later read route."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.hazards.models import HazardStatus


class PlanPosition(BaseModel):
    """A normalized pin position (0..1) on a floor plan image."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Hazard(BaseModel):
    """A hazard returned by a read route.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate.
        longitude: East-west coordinate.
        floor: Floor value the hazard sits on, or None (outside / no plan).
        status: open or resolved.
        created_at: When the hazard was stored.
        severity_score: Passage interference from 1 through 10.
        summary: The sentence to show for this hazard. A photo report
            contributes the model summary. A text report contributes
            what the member wrote. None when the hazard has no report.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    floor: int | None = None
    status: HazardStatus
    created_at: datetime
    severity_score: int = Field(ge=1, le=10)
    summary: str | None = None

    # Backing columns (excluded from output; surfaced via `position` below).
    position_x: float | None = Field(default=None, exclude=True)
    position_y: float | None = Field(default=None, exclude=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def position(self) -> PlanPosition | None:
        """The normalized plan pin, or None when the hazard has no position."""
        if self.position_x is None or self.position_y is None:
            return None
        return PlanPosition(x=self.position_x, y=self.position_y)
