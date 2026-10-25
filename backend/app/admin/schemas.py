"""A hazard as Facilities sees it."""

from datetime import datetime

from app.hazards.schemas import Hazard
from app.reports.models import HazardType


class AdminHazard(Hazard):
    """A hazard with the fields Facilities needs to act on it.

    Attributes:
        hazard_type: Type on the latest report, or None when the hazard
            has no report.
        report_count: How many reports describe this hazard.
        resolved_at: When the hazard was resolved, or None while open.
    """

    hazard_type: HazardType | None = None
    report_count: int = 0
    resolved_at: datetime | None = None
