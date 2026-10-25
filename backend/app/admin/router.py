"""Facilities routes. Every route requires the admin role."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.admin import service
from app.admin.schemas import AdminHazard
from app.admin.service import StatusFilter
from app.db import get_db
from app.members.deps import current_admin
from app.members.models import Member
from app.reports.service import RejectedReport

router = APIRouter(prefix="/admin/hazards", tags=["admin"])


@router.get("", response_model=list[AdminHazard])
def list_hazards(
    status: StatusFilter = "all",
    db: Session = Depends(get_db),
    _admin: Member = Depends(current_admin),
) -> list[AdminHazard]:
    """Lists hazards for Facilities, newest first.

    Args:
        status: open, resolved, or all. Deleted hazards never appear.
        db: Open database session.
        _admin: The signed-in admin.

    Returns:
        The matching hazards.
    """
    return service.list_hazards(db, status)


@router.post("/{hazard_id}/resolve", response_model=AdminHazard)
def resolve_hazard(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: Member = Depends(current_admin),
) -> AdminHazard:
    """Marks one hazard resolved.

    Args:
        hazard_id: The hazard to resolve.
        db: Open database session.
        admin: The signed-in admin, recorded as the resolver.

    Returns:
        The resolved hazard.

    Raises:
        HTTPException: No hazard has that id.
    """
    try:
        return service.resolve_hazard(db, hazard_id, admin)
    except RejectedReport as error:
        raise _rejected(error) from error


@router.delete("/{hazard_id}", status_code=204)
def delete_hazard(
    hazard_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: Member = Depends(current_admin),
) -> Response:
    """Deletes one hazard. Its reports and photos are kept.

    Args:
        hazard_id: The hazard to delete.
        db: Open database session.
        _admin: The signed-in admin.

    Returns:
        An empty 204 response.

    Raises:
        HTTPException: No hazard has that id.
    """
    try:
        service.delete_hazard(db, hazard_id)
    except RejectedReport as error:
        raise _rejected(error) from error
    return Response(status_code=204)


def _rejected(error: RejectedReport) -> HTTPException:
    """Maps a rejected action to an HTTP error.

    Args:
        error: The rejection from the admin service.

    Returns:
        The HTTP error the route raises.
    """
    return HTTPException(status_code=error.status_code, detail=error.detail)
