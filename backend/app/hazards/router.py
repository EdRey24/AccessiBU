"""Read routes for hazards.

Hazards are created by report submissions. These routes only read them
back so every device can draw the same pins.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.hazards.models import Hazard as HazardRow
from app.hazards.models import HazardStatus
from app.hazards.schemas import Hazard
from app.members.deps import current_member
from app.members.models import Member as MemberRow

router = APIRouter(prefix="/hazards", tags=["hazards"])


@router.get("", response_model=list[Hazard])
def list_hazards(
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> list[HazardRow]:
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
    return list(db.scalars(statement).all())


@router.get("/{hazard_id}", response_model=Hazard)
def read_hazard(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    _member: MemberRow = Depends(current_member),
) -> HazardRow:
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
    return hazard
