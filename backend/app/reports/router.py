"""Report submission routes.

A text report is JSON. A photo report is one image plus the place it
belongs. The vision call fills the photo's hazard type, category,
summary, and severity. POST /classify previews that call without
storing a report.
"""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.members.deps import current_member
from app.members.models import Member
from app.reports import own
from app.reports.classify import ClassificationError, classify
from app.reports.preview import (
    PreviewClassification,
    PreviewContextError,
    load_preview_context,
    preview_classification,
)
from app.reports.models import HazardType
from app.reports.schemas import (
    Classification,
    OwnReport,
    PhotoReport,
    ReportEdit,
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

logger = logging.getLogger("uvicorn.error")
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
    description: Annotated[str | None, Form()] = None,
    hazard_type: Annotated[str | None, Form()] = None,
    severity_score: Annotated[int | None, Form()] = None,
    classify_photo: Annotated[bool, Form(alias="classify")] = True,
    category: Annotated[int | None, Form()] = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> PhotoReport:
    """Stores a photo report.

    With classify set to false the vision call is skipped. The photo is
    stored as an attachment, and the member's hazard type, severity, and
    description are kept as given for Facilities to confirm on site.

    Args:
        image: The captured photo.
        latitude: North-south coordinate of a new hazard.
        longitude: East-west coordinate of a new hazard.
        hazard_id: An open hazard to attach to.
        floor: Floor the pin sits on. Omit for an outside hazard.
        position_x: Normalized pin x on the floor plan.
        position_y: Normalized pin y on the floor plan.
        description: What the member wrote. The vision call uses it
            with the photo.
        hazard_type: Type the member confirmed after the preview.
            Omit to keep the vision type.
        severity_score: Passage interference the member confirmed,
            from 0 through 100. Omit to keep the vision score.
        classify_photo: False skips the vision call. Then hazard_type,
            severity_score, and description are required.
        category: Numeric code for an unclassified photo. Defaults to 0.
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
    chosen_type = _member_type(hazard_type)
    chosen_score = _member_score(severity_score)
    note = _note(description)
    manual = None
    if not classify_photo:
        manual = _manual_classification(
            chosen_type,
            chosen_score,
            note,
            category,
        )
    raw = await image.read(MAX_IMAGE_BYTES + 1)
    try:
        return store_photo(
            db,
            member,
            raw,
            place,
            note,
            chosen_type,
            chosen_score,
            manual=manual,
        )
    except RejectedReport as error:
        raise _rejected(error) from error
    except StorageError as error:
        raise HTTPException(
            status_code=502,
            detail="Storage is unavailable.",
        ) from error


@router.get("/mine", response_model=list[OwnReport])
def list_my_reports(
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> list[OwnReport]:
    """Lists the signed-in member's own reports, newest first.

    Args:
        member: The signed-in member.
        db: Open database session.

    Returns:
        Only reports this member submitted.
    """
    return own.list_own(db, member)


@router.get("/{report_id}/photo")
def read_my_report_photo(
    report_id: UUID,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> Response:
    """Returns the photo of one of the member's own reports.

    Args:
        report_id: The report whose photo to load.
        member: The signed-in member.
        db: Open database session.

    Returns:
        The image bytes.

    Raises:
        HTTPException: The report is not the member's or has no photo.
    """
    try:
        body, media_type = own.photo_of(db, member, report_id)
    except RejectedReport as error:
        raise _rejected(error) from error
    return Response(content=body, media_type=media_type)


@router.patch("/{report_id}", response_model=OwnReport)
def edit_my_report(
    report_id: UUID,
    edit: ReportEdit,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> OwnReport:
    """Edits one of the member's own reports.

    Args:
        report_id: The report to change.
        edit: The fields to change.
        member: The signed-in member.
        db: Open database session.

    Returns:
        The report after the change.

    Raises:
        HTTPException: The report is not the member's, its hazard is
            resolved, or the location is shared with other reports.
    """
    try:
        return own.edit_own(db, member, report_id, edit)
    except RejectedReport as error:
        raise _rejected(error) from error


@router.put("/{report_id}/photo", response_model=OwnReport)
async def replace_my_report_photo(
    report_id: UUID,
    image: Annotated[UploadFile, File()],
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> OwnReport:
    """Replaces the photo on one of the member's own photo reports.

    Args:
        report_id: The photo report to change.
        image: The new photo.
        member: The signed-in member.
        db: Open database session.

    Returns:
        The report after the change.

    Raises:
        HTTPException: The report is not the member's, the photo was
            rejected, or storage is unavailable.
    """
    raw = await image.read(MAX_IMAGE_BYTES + 1)
    try:
        return own.replace_photo(db, member, report_id, raw)
    except RejectedReport as error:
        raise _rejected(error) from error
    except StorageError as error:
        raise HTTPException(
            status_code=502,
            detail="Storage is unavailable.",
        ) from error


@router.delete("/{report_id}", status_code=204)
def delete_my_report(
    report_id: UUID,
    member: Member = Depends(current_member),
    db: Session = Depends(get_db),
) -> Response:
    """Deletes one of the member's own reports.

    Args:
        report_id: The report to delete.
        member: The signed-in member.
        db: Open database session.

    Returns:
        An empty 204 response.

    Raises:
        HTTPException: The report is not the member's, or its hazard is
            resolved.
    """
    try:
        own.delete_own(db, member, report_id)
    except RejectedReport as error:
        raise _rejected(error) from error
    return Response(status_code=204)


@classify_router.post("/classify", response_model=PreviewClassification)
async def classify_photo(
    image: Annotated[UploadFile, File()],
    context: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    member: Member = Depends(current_member),
) -> PreviewClassification:
    """Classifies a photo without storing a report.

    Args:
        image: The captured photo.
        context: JSON spatial context, when the pin is on a floor plan.
        description: What the member wrote. The type and severity come
            from this text and the photo together.
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
        classification = classify(raw, inspected.media_type, _note(description))
    except RejectedReport as error:
        raise _rejected(error) from error
    except PreviewContextError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ClassificationError as error:
        logger.warning("Preview classification failed: %s", error)
        raise HTTPException(
            status_code=422,
            detail="The photo could not be classified.",
        ) from error
    return preview_classification(classification, parsed)


def _member_type(value: str | None) -> HazardType | None:
    """Reads a confirmed hazard type, or leaves the vision type.

    Args:
        value: The form field, or nothing.

    Returns:
        The stored hazard type, or None when the field was omitted.

    Raises:
        HTTPException: The value is not a known hazard type.
    """
    if value is None or value.strip() == "":
        return None
    try:
        return HazardType(value.strip())
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail="Hazard type is not recognized.",
        ) from error


def _member_score(value: int | None) -> int | None:
    """Reads a confirmed severity, or leaves the vision score.

    Args:
        value: Passage interference from 0 through 100, or nothing.

    Returns:
        The score, or None when the field was omitted.

    Raises:
        HTTPException: The score is outside 0 through 100.
    """
    if value is None:
        return None
    if value < 0 or value > 100:
        raise HTTPException(
            status_code=422,
            detail="Severity is from 0 through 100.",
        )
    return value


def _manual_classification(
    hazard_type: HazardType | None,
    severity_score: int | None,
    note: str | None,
    category: int | None,
) -> Classification:
    """Builds the stored fields for a photo that skips the vision call.

    Args:
        hazard_type: Type the member chose.
        severity_score: Passage interference the member chose.
        note: What the member wrote. Becomes the photo summary.
        category: Numeric code, or nothing for 0.

    Returns:
        The member's values in the shape the vision call returns.

    Raises:
        HTTPException: A required member value is missing.
    """
    if hazard_type is None or severity_score is None or note is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "An unclassified photo needs a hazard type, a severity, "
                "and a description."
            ),
        )
    return Classification(
        hazard_type=hazard_type,
        category=0 if category is None else category,
        severity_score=severity_score,
        summary=note,
    )


def _note(description: str | None) -> str | None:
    """Strips a member description, or drops a blank one.

    Args:
        description: The form field, or nothing.

    Returns:
        The stripped description, or None when it is blank.

    Raises:
        HTTPException: The description is longer than 1000 characters.
    """
    if description is None:
        return None
    note = description.strip()
    if note == "":
        return None
    if len(note) > 1000:
        raise HTTPException(
            status_code=422,
            detail="The description is at most 1000 characters.",
        )
    return note


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
