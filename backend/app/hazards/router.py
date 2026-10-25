"""Read routes for hazards.

Hazards are created by report submissions. These routes only read them
back so every device can draw the same pins.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.hazards.models import Hazard as HazardRow
from app.hazards.models import HazardStatus
from app.hazards.schemas import Hazard
from app.members.deps import current_member
from app.members.models import Member as MemberRow
from app.reports.schemas import Report
from app.reports.service import (
    RejectedReport,
    hazard_photo,
    list_reports,
    report_body,
    report_summaries,
)

router = APIRouter(prefix="/hazards", tags=["hazards"])


def _with_summaries(db: Session, rows: list[HazardRow]) -> list[Hazard]:
    """Copies hazard rows and attaches each report sentence.

    Args:
        db: Open database session.
        rows: Hazard rows to return.

    Returns:
        Response models with the photo summary or written note.
    """
    summaries = report_summaries(db, [row.id for row in rows])
    bodies: list[Hazard] = []
    for row in rows:
        body = Hazard.model_validate(row)
        bodies.append(body.model_copy(update={"summary": summaries.get(row.id)}))
    return bodies


@router.get("", response_model=list[Hazard])
def list_hazards(
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> list[Hazard]:
    """Lists open hazards, newest first.

    Args:
        db: Open database session.
        _member: The signed-in member. Reading requires a session.

    Returns:
        Every open hazard, ordered by creation time descending.
    """
    statement = (
        select(HazardRow)
        .where(HazardRow.status == HazardStatus.OPEN)
        .order_by(HazardRow.created_at.desc())
    )
    rows = list(db.scalars(statement).all())
    return _with_summaries(db, rows)


@router.get("/{hazard_id}", response_model=Hazard)
def read_hazard(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> Hazard:
    """Returns one hazard by id.

    Args:
        hazard_id: Primary key of the hazard to read.
        db: Open database session.
        _member: The signed-in member. Reading requires a session.

    Returns:
        The hazard with this id.

    Raises:
        HTTPException: No hazard has this id.
    """
    hazard = db.get(HazardRow, hazard_id)
    if hazard is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hazard was not found.",
        )
    return _with_summaries(db, [hazard])[0]


@router.get("/{hazard_id}/photo")
def read_hazard_photo(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> Response:
    """Returns the photo stored for one hazard.

    Args:
        hazard_id: The hazard whose photo to load.
        db: Open database session.
        _member: The signed-in member. Reading requires a session.

    Returns:
        The image bytes.

    Raises:
        HTTPException: The hazard is missing, it has no photo, or
            storage could not return the object.
    """
    try:
        body, media_type = hazard_photo(db, hazard_id)
    except RejectedReport as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
        ) from error
    return Response(content=body, media_type=media_type)


@router.get("/{hazard_id}/reports", response_model=list[Report])
def read_hazard_reports(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> list[Report]:
    """Lists the reports that describe one hazard.

    Args:
        hazard_id: The hazard whose reports to load.
        db: Open database session.
        _member: The signed-in member. Reading requires a session.

    Returns:
        Reports in the order they were stored.

    Raises:
        HTTPException: No hazard has that id.
    """
    try:
        rows = list_reports(db, hazard_id)
    except RejectedReport as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
        ) from error
    return [report_body(row) for row in rows]
