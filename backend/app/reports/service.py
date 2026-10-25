"""Stores a finished report and the hazard it describes.

A photo is uploaded, classified, and then committed. If the row does
not commit, the object is deleted. A text report writes its severity
onto the hazard directly.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.hazards.models import Hazard, HazardStatus
from app.members.models import Member
from app.reports.models import HazardType, Report, ReportKind
from app.reports.schemas import (
    Classification,
    PhotoReport,
    ReportPlace,
    TextReport,
    TextReportSubmit,
)
from app.reports.storage import (
    StorageError,
    delete_object,
    get_object,
    put_object,
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024

_HEIC_BRANDS = {
    b"heic",
    b"heix",
    b"hevc",
    b"hevx",
    b"heim",
    b"heis",
    b"hevm",
    b"hevs",
    b"mif1",
    b"msf1",
}


class RejectedReport(Exception):
    """The submission cannot be stored.

    Attributes:
        status_code: HTTP status the route should return.
        detail: Message safe to show the member.
    """

    def __init__(self, status_code: int, detail: str) -> None:
        """Stores the status and detail.

        Args:
            status_code: HTTP status to remember.
            detail: Message safe to show the member.
        """
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@dataclass(frozen=True)
class _Image:
    """Bytes that may be stored as a photo.

    Attributes:
        media_type: image/jpeg, image/png, or image/heic.
        extension: Suffix used in the object key.
    """

    media_type: str
    extension: str


def store_text(
    db: Session,
    member: Member,
    submission: TextReportSubmit,
) -> TextReport:
    """Stores a text report and copies its severity onto the hazard.

    Args:
        db: Open database session.
        member: The member who submitted the report.
        submission: The text and where it belongs.

    Returns:
        The stored text report.

    Raises:
        RejectedReport: The hazard is missing or resolved.
    """
    hazard = _hazard(db, submission, submission.severity_score)
    row = Report(
        kind=ReportKind.TEXT,
        hazard_id=hazard.id,
        member_id=member.id,
        hazard_type=submission.hazard_type,
        category=submission.category,
        description=submission.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return report_body(row)


def store_photo(
    db: Session,
    member: Member,
    image: bytes,
    place: ReportPlace,
    description: str | None = None,
    hazard_type: HazardType | None = None,
    severity_score: int | None = None,
    manual: Classification | None = None,
) -> PhotoReport:
    """Stores a photo report after the vision call succeeds.

    When manual is given the vision call is skipped and those values are
    stored as the member entered them.

    Args:
        db: Open database session.
        member: The member who submitted the report.
        image: Raw image bytes.
        place: Where the photo belongs.
        description: What the member wrote. The vision call uses it
            with the photo.
        hazard_type: Type the member confirmed. Replaces the vision
            type when present. The vision summary stays.
        severity_score: Passage interference the member confirmed,
            from 1 through 10. Replaces the vision score when present.
        manual: The member's own type, severity, and summary for a photo
            that is not classified.

    Returns:
        The stored photo report.

    Raises:
        RejectedReport: The image, the hazard, or the vision call was
            rejected. A photo that shows no hazard is refused.
        StorageError: The object could not be uploaded.
    """
    inspected = inspect_image(image)
    report_id = uuid.uuid4()
    path = f"{report_id}{inspected.extension}"
    if place.hazard_id is not None:
        _require_open(db, place.hazard_id)
    put_object(path, image, inspected.media_type)
    try:
        classification = (
            manual
            if manual is not None
            else _classify(image, inspected.media_type, description)
        )
        if hazard_type is not None:
            classification = classification.model_copy(
                update={"hazard_type": hazard_type},
            )
        score = (
            classification.severity_score
            if severity_score is None
            else severity_score
        )
        hazard = _hazard(db, place, score)
        row = _photo_row(report_id, path, member, hazard, classification)
        db.add(row)
        db.commit()
    except Exception as error:
        db.rollback()
        _discard(path)
        if _not_a_hazard(error):
            from app.reports.classify import NOT_A_HAZARD

            raise RejectedReport(422, NOT_A_HAZARD) from error
        if _classification_failed(error):
            raise RejectedReport(
                422,
                "The photo could not be classified.",
            ) from error
        raise
    db.refresh(row)
    return report_body(row)


def inspect_image(body: bytes) -> _Image:
    """Identifies a JPEG, PNG, or HEIC photo.

    Args:
        body: Raw image bytes.

    Returns:
        The media type and file extension.

    Raises:
        RejectedReport: The file is empty, larger than 10 MB, or not a
            JPEG, PNG, or HEIC.
    """
    if not body:
        raise RejectedReport(400, "A photo is required.")
    if len(body) > MAX_IMAGE_BYTES:
        raise RejectedReport(413, "A photo is at most 10 MB.")
    if body.startswith(b"\xff\xd8\xff"):
        return _Image("image/jpeg", ".jpg")
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return _Image("image/png", ".png")
    if _is_heic(body):
        return _Image("image/heic", ".heic")
    raise RejectedReport(400, "A photo is JPEG, PNG, or HEIC.")


def report_body(row: Report) -> PhotoReport | TextReport:
    """Copies a report row into its response model.

    Args:
        row: A stored report.

    Returns:
        The photo or text body.
    """
    payload = {
        "kind": row.kind.value,
        "id": row.id,
        "hazard_id": row.hazard_id,
        "member_id": row.member_id,
        "created_at": row.created_at,
        "hazard_type": row.hazard_type,
        "category": row.category,
    }
    if row.kind is ReportKind.PHOTO:
        payload["image_path"] = row.image_path
        payload["summary"] = row.summary
        return PhotoReport.model_validate(payload)
    payload["description"] = row.description
    return TextReport.model_validate(payload)


def hazard_photo(db: Session, hazard_id: uuid.UUID) -> tuple[bytes, str]:
    """Loads the photo stored for one hazard.

    Args:
        db: Open database session.
        hazard_id: The hazard whose photo to load.

    Returns:
        The image bytes and their media type.

    Raises:
        RejectedReport: The hazard is missing, it has no photo, or
            storage could not return the object.
    """
    _require_hazard(db, hazard_id)
    row = db.scalar(
        select(Report)
        .where(
            Report.hazard_id == hazard_id,
            Report.kind == ReportKind.PHOTO,
        )
        .order_by(Report.created_at.asc()),
    )
    if row is None or row.image_path is None:
        raise RejectedReport(404, "This hazard has no photo.")
    try:
        return get_object(row.image_path)
    except StorageError as error:
        raise RejectedReport(502, "The photo could not be loaded.") from error


def report_summaries(
    db: Session,
    hazard_ids: list[uuid.UUID],
) -> dict[uuid.UUID, str]:
    """The sentence stored for each hazard.

    A later report replaces an earlier one. A photo contributes its
    model summary. A text report contributes the member's note.

    Args:
        db: Open database session.
        hazard_ids: Hazards whose sentences to load.

    Returns:
        Hazard id to the sentence to show. Hazards with no text are
        absent.
    """
    if not hazard_ids:
        return {}
    rows = db.scalars(
        select(Report)
        .where(Report.hazard_id.in_(hazard_ids))
        .order_by(Report.created_at.asc()),
    ).all()
    summaries: dict[uuid.UUID, str] = {}
    for row in rows:
        text = row.summary if row.kind is ReportKind.PHOTO else row.description
        if text:
            summaries[row.hazard_id] = text
    return summaries


def list_reports(db: Session, hazard_id: uuid.UUID) -> list[Report]:
    """Loads the reports that describe one hazard.

    Args:
        db: Open database session.
        hazard_id: The hazard whose reports to load.

    Returns:
        Reports in the order they were stored.

    Raises:
        RejectedReport: No hazard has that id.
    """
    _require_hazard(db, hazard_id)
    return list(
        db.scalars(
            select(Report)
            .where(Report.hazard_id == hazard_id)
            .order_by(Report.created_at.asc()),
        ).all(),
    )


def _classify(
    image: bytes,
    media_type: str,
    description: str | None = None,
) -> Classification:
    """Runs the one vision call.

    Args:
        image: Raw image bytes.
        media_type: Media type already checked for this file.
        description: What the member wrote, or nothing.

    Returns:
        The classification to write onto the report and the hazard.
    """
    from app.reports.classify import classify

    return classify(image, media_type, description)


def _not_a_hazard(error: Exception) -> bool:
    """Reports whether the vision call refused the photo.

    Args:
        error: The error raised while storing the photo.

    Returns:
        True when the photo does not show a hazard.
    """
    try:
        from app.reports.classify import NotAHazard
    except ImportError:
        return False
    return isinstance(error, NotAHazard)


def _classification_failed(error: Exception) -> bool:
    """Reports whether the vision call rejected the photo.

    Args:
        error: The error raised while storing the photo.

    Returns:
        True when the error is a ClassificationError.
    """
    try:
        from app.reports.classify import ClassificationError
    except ImportError:
        return False
    return isinstance(error, ClassificationError)


def _hazard(db: Session, place: ReportPlace, severity_score: int) -> Hazard:
    """Opens a hazard or copies a new severity onto an open one.

    Args:
        db: Open database session.
        place: Where the submission belongs.
        severity_score: Passage interference from this submission.

    Returns:
        The hazard the report will point at.

    Raises:
        RejectedReport: The hazard is missing or resolved.
    """
    if place.hazard_id is not None:
        hazard = _require_open(db, place.hazard_id)
        hazard.severity_score = severity_score
        return hazard
    hazard = Hazard(
        latitude=place.latitude,
        longitude=place.longitude,
        floor=place.floor,
        position_x=place.position_x,
        position_y=place.position_y,
        status=HazardStatus.OPEN,
        severity_score=severity_score,
    )
    db.add(hazard)
    db.flush()
    return hazard


def _require_open(db: Session, hazard_id: uuid.UUID) -> Hazard:
    """Loads a hazard that can still receive a report.

    Args:
        db: Open database session.
        hazard_id: The hazard to attach to.

    Returns:
        The open hazard.

    Raises:
        RejectedReport: The hazard is missing or resolved.
    """
    hazard = _require_hazard(db, hazard_id)
    if hazard.status is not HazardStatus.OPEN:
        raise RejectedReport(409, "A resolved hazard stays resolved.")
    return hazard


def _require_hazard(db: Session, hazard_id: uuid.UUID) -> Hazard:
    """Loads a hazard or rejects the call.

    Args:
        db: Open database session.
        hazard_id: The hazard to load.

    Returns:
        The hazard.

    Raises:
        RejectedReport: No hazard has that id, or Facilities deleted it.
    """
    hazard = db.get(Hazard, hazard_id)
    if hazard is None or hazard.deleted_at is not None:
        raise RejectedReport(404, "Hazard not found.")
    return hazard


def _photo_row(
    report_id: uuid.UUID,
    path: str,
    member: Member,
    hazard: Hazard,
    classification: Classification,
) -> Report:
    """Builds a finished photo row from a classification.

    Args:
        report_id: Primary key, also used in the object key.
        path: Storage key of the uploaded image.
        member: The member who submitted the photo.
        hazard: The hazard this photo describes.
        classification: The vision call's return value.

    Returns:
        An unsaved photo report.
    """
    return Report(
        id=report_id,
        kind=ReportKind.PHOTO,
        hazard_id=hazard.id,
        member_id=member.id,
        hazard_type=classification.hazard_type,
        category=classification.category,
        image_path=path,
        summary=classification.summary,
    )


def _is_heic(body: bytes) -> bool:
    """Reports whether the bytes are an HEIC file.

    Args:
        body: Raw image bytes.

    Returns:
        True when the file brand is an HEIC brand.
    """
    if len(body) < 12 or body[4:8] != b"ftyp":
        return False
    return body[8:12] in _HEIC_BRANDS


def _discard(path: str) -> None:
    """Deletes an uploaded photo after the report failed to commit.

    A failed delete leaves the object in place. The report row is
    already rolled back.

    Args:
        path: Object key to delete.
    """
    try:
        delete_object(path)
    except StorageError:
        return
