"""Routes that store hazard reports.

A text submission opens a hazard at a coordinate, or attaches to an
open one, and stores the member's description. The severity it carries
is written onto the hazard. Photo submissions are not served here yet.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.hazards.models import Hazard as HazardRow
from app.hazards.models import HazardStatus
from app.members.deps import current_member
from app.members.models import Member as MemberRow
from app.reports.models import Report as ReportRow
from app.reports.models import ReportKind
from app.reports.schemas import TextReport, TextReportSubmit

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/text", response_model=TextReport, status_code=201)
def submit_text_report(
    body: TextReportSubmit,
    db: Session = Depends(get_db),
    member: MemberRow = Depends(current_member),
) -> ReportRow:
    """Stores a manual hazard report.

    Opens a new hazard at the coordinate when no hazard id is given, or
    attaches the report to the named open hazard. The submission's
    severity is written onto the hazard.

    Args:
        body: The description, severity, and where it belongs.
        db: Open database session.
        member: The signed-in member who submitted it.

    Returns:
        The stored text report.

    Raises:
        HTTPException: The named hazard is missing or already resolved.
    """
    hazard = _resolve_hazard(body, db)
    report = ReportRow(
        kind=ReportKind.TEXT,
        hazard_id=hazard.id,
        member_id=member.id,
        hazard_type=body.hazard_type,
        category=body.category,
        description=body.description,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def _resolve_hazard(body: TextReportSubmit, db: Session) -> HazardRow:
    """Finds the open hazard a report attaches to, or opens one.

    Args:
        body: The submission, carrying either a hazard id or a place.
        db: Open database session.

    Returns:
        The hazard the report will reference. A newly opened hazard is
        flushed so its id is available.

    Raises:
        HTTPException: The named hazard is missing or already resolved.
    """
    if body.hazard_id is not None:
        hazard = db.get(HazardRow, body.hazard_id)
        if hazard is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Hazard was not found.",
            )
        if hazard.status is not HazardStatus.OPEN:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Hazard is already resolved.",
            )
        return hazard
    hazard = HazardRow(
        latitude=body.latitude,
        longitude=body.longitude,
        status=HazardStatus.OPEN,
        severity_score=body.severity_score,
    )
    db.add(hazard)
    db.flush()
    return hazard
