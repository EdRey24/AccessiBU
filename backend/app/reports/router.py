"""Report submission routes.

A text report is JSON. A photo report is one image plus the place it
belongs. The vision call fills the photo's hazard type, category,
summary, and severity. POST /classify previews that call without
storing a report.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.members.deps import current_member
from app.members.models import Member
from app.reports.classify import ClassificationError, classify
from app.reports.preview import (
    PreviewClassification,
    PreviewContextError,
    load_preview_context,
    preview_classification,
)
from app.reports.schemas import (
    PhotoReport,
    ReportPlace,
    TextReport,
    TextReportSubmit,
)
from app.reports.service import (
    MAX_IMAGE_BYTES,
    RejectedReport,
    inspect_image,
    store_photo,
    store_text,
)
from app.reports.storage import StorageError

router = APIRouter(prefix="/reports", tags=["reports"])
classify_router = APIRouter(tags=["classify"])


@router.post("/text", response_model=TextReport, status_code=201)
def create_text_report(
    submission: TextReportSubmit,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> TextReport:
    """Stores a text report.

    Args:
        submission: The text and where it belongs.
        member: The signed-in member.
        db: Open database session.

    Returns:
        The stored text report.

    Raises:
        HTTPException: The hazard cannot take the report.
    """
    try:
        return store_text(db, member, submission)
    except RejectedReport as error:
        raise _rejected(error) from error


@router.post("/photo", response_model=PhotoReport, status_code=201)
async def create_photo_report(
    image: Annotated[UploadFile, File()],
    latitude: Annotated[float | None, Form()] = None,
    longitude: Annotated[float | None, Form()] = None,
    hazard_id: Annotated[UUID | None, Form()] = None,
    floor: Annotated[int | None, Form()] = None,
    position_x: Annotated[float | None, Form()] = None,
    position_y: Annotated[float | None, Form()] = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> PhotoReport:
    """Stores a photo report.

    Args:
        image: The captured photo.
        latitude: North-south coordinate of a new hazard.
        longitude: East-west coordinate of a new hazard.
        hazard_id: An open hazard to attach to.
        floor: Floor the pin sits on. Omit for an outside hazard.
        position_x: Normalized pin x on the floor plan.
        position_y: Normalized pin y on the floor plan.
        member: The signed-in member.
        db: Open database session.

    Returns:
        The stored photo report.

    Raises:
        HTTPException: The photo or the hazard was rejected, or storage
            is unavailable.
    """
    place = _place(
        latitude,
        longitude,
        hazard_id,
        floor,
        position_x,
        position_y,
    )
    raw = await image.read(MAX_IMAGE_BYTES + 1)
    try:
        return store_photo(db, member, raw, place)
    except RejectedReport as error:
        raise _rejected(error) from error
    except StorageError as error:
        raise HTTPException(
            status_code=502,
            detail="Storage is unavailable.",
        ) from error


@classify_router.post("/classify", response_model=PreviewClassification)
async def classify_photo(
    image: Annotated[UploadFile, File()],
    context: Annotated[str | None, Form()] = None,
    member: Member = Depends(current_member),
) -> PreviewClassification:
    """Classifies a photo without storing a report.

    Args:
        image: The captured photo.
        context: JSON spatial context, when the pin is on a floor plan.
        member: The signed-in member.

    Returns:
        A display type, a 1–10 severity, and a short description.

    Raises:
        HTTPException: The photo, the context, or the vision call was
            rejected.
    """
    raw = await image.read(MAX_IMAGE_BYTES + 1)
    try:
        inspected = inspect_image(raw)
        parsed = load_preview_context(context)
        classification = classify(raw, inspected.media_type)
    except RejectedReport as error:
        raise _rejected(error) from error
    except PreviewContextError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ClassificationError as error:
        raise HTTPException(
            status_code=422,
            detail="The photo could not be classified.",
        ) from error
    return preview_classification(classification, parsed)


def _place(
    latitude: float | None,
    longitude: float | None,
    hazard_id: UUID | None,
    floor: int | None,
    position_x: float | None,
    position_y: float | None,
) -> ReportPlace:
    """Validates where a photo belongs.

    Args:
        latitude: North-south coordinate of a new hazard.
        longitude: East-west coordinate of a new hazard.
        hazard_id: An open hazard to attach to.
        floor: Floor the pin sits on. Omit for an outside hazard.
        position_x: Normalized pin x on the floor plan.
        position_y: Normalized pin y on the floor plan.

    Returns:
        The validated place.

    Raises:
        HTTPException: The place is incomplete or out of range.
    """
    try:
        return ReportPlace.model_validate(
            {
                "latitude": latitude,
                "longitude": longitude,
                "hazard_id": hazard_id,
                "floor": floor,
                "position_x": position_x,
                "position_y": position_y,
            },
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=error.errors(),
        ) from error


def _rejected(error: RejectedReport) -> HTTPException:
    """Maps a rejected submission to an HTTP error.

    Args:
        error: The rejection from the report service.

    Returns:
        The HTTP error the route raises.
    """
    return HTTPException(status_code=error.status_code, detail=error.detail)
