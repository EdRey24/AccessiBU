"""Hazard read routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.hazards.models import Hazard as HazardRow
from app.hazards.schemas import Hazard
from app.members.deps import current_member
from app.reports.schemas import Report
from app.reports.service import (
    RejectedReport,
    hazard_bodies,
    list_reports,
    report_body,
)

router = APIRouter(prefix="/hazards", tags=["hazards"])


@router.get("", response_model=list[Hazard])
def read_hazards(
    _: object = Depends(current_member),
    db: Session = Depends(get_db),
) -> list[Hazard]:
    """Lists every stored hazard, newest first, with its newest report.

    Args:
        _: The signed-in member. The list is shared.
        db: Open database session.

    Returns:
        The stored hazards.
    """
    rows = db.scalars(
        select(HazardRow).order_by(HazardRow.created_at.desc()),
    ).all()
    return hazard_bodies(db, list(rows))


@router.get("/{hazard_id}", response_model=Hazard)
def read_hazard(
    hazard_id: UUID,
    _: object = Depends(current_member),
    db: Session = Depends(get_db),
) -> Hazard:
    """Loads one hazard.

    Args:
        hazard_id: The hazard to load.
        _: The signed-in member.
        db: Open database session.

    Returns:
        The stored hazard.

    Raises:
        HTTPException: No hazard has that id.
    """
    row = db.get(HazardRow, hazard_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Hazard not found.")
    return hazard_bodies(db, [row])[0]


@router.get("/{hazard_id}/reports", response_model=list[Report])
def read_hazard_reports(
    hazard_id: UUID,
    _: object = Depends(current_member),
    db: Session = Depends(get_db),
) -> list[Report]:
    """Lists the reports that describe one hazard.

    Args:
        hazard_id: The hazard whose reports to load.
        _: The signed-in member.
        db: Open database session.

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
