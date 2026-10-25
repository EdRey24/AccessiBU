"""A member's own reports: list, edit, replace the photo, and delete.

Ownership is enforced in one place. Every lookup filters on the id of
the signed-in member, which comes from the verified access token and
never from the request. A report that belongs to someone else is
reported as not found, exactly like a report that does not exist, for
every role including admins. Facilities manage hazards through the
admin routes instead.

A report on a resolved or deleted hazard cannot be changed. A member
can move the hazard only when theirs is the only report on it, because
the location is shared with everyone else who reported it.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.hazards.models import Hazard, HazardStatus
from app.hazards.schemas import PlanPosition
from app.members.models import Member
from app.reports import service
from app.reports.models import Report, ReportKind
from app.reports.schemas import OwnReport, ReportEdit
from app.reports.service import RejectedReport
from app.reports.storage import StorageError


def list_own(db: Session, member: Member) -> list[OwnReport]:
    """Lists the member's reports on hazards that still exist.

    Args:
        db: Open database session.
        member: The signed-in member.

    Returns:
        The member's reports, newest first. Reports by other members are
        never included.
    """
    rows = db.execute(
        select(Report, Hazard)
        .join(Hazard, Hazard.id == Report.hazard_id)
        .where(Report.member_id == member.id, Hazard.deleted_at.is_(None))
        .order_by(Report.created_at.desc()),
    ).all()
    counts = _counts(db, {hazard.id for _, hazard in rows})
    return [_body(report, hazard, counts[hazard.id]) for report, hazard in rows]


def photo_of(
    db: Session,
    member: Member,
    report_id: uuid.UUID,
) -> tuple[bytes, str]:
    """Loads the photo of the member's own report.

    Args:
        db: Open database session.
        member: The signed-in member.
        report_id: The report whose photo to load.

    Returns:
        The image bytes and their media type.

    Raises:
        RejectedReport: The report is not the member's, it has no photo,
            or storage could not return the object.
    """
    row, _hazard = _owned(db, member, report_id)
    if row.image_path is None:
        raise RejectedReport(404, "This report has no photo.")
    try:
        return service.get_object(row.image_path)
    except StorageError as error:
        raise RejectedReport(502, "The photo could not be loaded.") from error


def edit_own(
    db: Session,
    member: Member,
    report_id: uuid.UUID,
    edit: ReportEdit,
) -> OwnReport:
    """Changes the fields a member may edit on their own report.

    Args:
        db: Open database session.
        member: The signed-in member.
        report_id: The report to change.
        edit: The new values. Omitted fields stay as they are.

    Returns:
        The report after the change.

    Raises:
        RejectedReport: The report is not the member's, its hazard is
            resolved, or the location is shared with other reports.
    """
    row, hazard = _owned(db, member, report_id)
    _require_open(hazard)
    if edit.location is not None and _counts(db, {hazard.id})[hazard.id] > 1:
        raise RejectedReport(
            409,
            "Other members reported this hazard, so its location "
            "cannot be changed.",
        )
    if edit.description is not None:
        if row.kind is ReportKind.PHOTO:
            row.summary = edit.description
        else:
            row.description = edit.description
    if edit.hazard_type is not None:
        row.hazard_type = edit.hazard_type
    if edit.location is not None:
        hazard.latitude = edit.location.latitude
        hazard.longitude = edit.location.longitude
        hazard.floor = edit.location.floor
        hazard.position_x = edit.location.position_x
        hazard.position_y = edit.location.position_y
    db.commit()
    db.refresh(row)
    db.refresh(hazard)
    return _body(row, hazard, _counts(db, {hazard.id})[hazard.id])


def replace_photo(
    db: Session,
    member: Member,
    report_id: uuid.UUID,
    image: bytes,
) -> OwnReport:
    """Swaps the photo on the member's own photo report.

    The new photo is not classified again. The type and text the member
    has set stay as they are.

    Args:
        db: Open database session.
        member: The signed-in member.
        report_id: The photo report to change.
        image: Raw bytes of the new photo.

    Returns:
        The report after the change.

    Raises:
        RejectedReport: The report is not the member's, it is not a
            photo report, its hazard is resolved, or the image is bad.
        StorageError: The new object could not be uploaded.
    """
    row, hazard = _owned(db, member, report_id)
    _require_open(hazard)
    if row.kind is not ReportKind.PHOTO:
        raise RejectedReport(409, "Only a photo report has a photo.")
    inspected = service.inspect_image(image)
    old_path = row.image_path
    path = f"{uuid.uuid4()}{inspected.extension}"
    service.put_object(path, image, inspected.media_type)
    try:
        row.image_path = path
        db.commit()
    except Exception:
        db.rollback()
        _discard(path)
        raise
    if old_path is not None:
        _discard(old_path)
    db.refresh(row)
    return _body(row, hazard, _counts(db, {hazard.id})[hazard.id])


def delete_own(db: Session, member: Member, report_id: uuid.UUID) -> None:
    """Deletes the member's own report and its photo.

    If it was the last report on the hazard, the hazard is deleted too,
    so no empty pin is left on the map.

    Args:
        db: Open database session.
        member: The signed-in member.
        report_id: The report to delete.

    Raises:
        RejectedReport: The report is not the member's, or its hazard is
            resolved.
    """
    row, hazard = _owned(db, member, report_id)
    _require_open(hazard)
    remaining = _counts(db, {hazard.id})[hazard.id] - 1
    path = row.image_path
    db.delete(row)
    if remaining == 0:
        hazard.deleted_at = datetime.now(UTC)
    db.commit()
    if path is not None:
        _discard(path)


def _owned(
    db: Session,
    member: Member,
    report_id: uuid.UUID,
) -> tuple[Report, Hazard]:
    """Loads a report only if it belongs to the member.

    Args:
        db: Open database session.
        member: The signed-in member.
        report_id: The report to load.

    Returns:
        The report and its hazard.

    Raises:
        RejectedReport: No such report belongs to this member, or its
            hazard was deleted. The two cases look the same on purpose.
    """
    row = db.scalar(
        select(Report).where(
            Report.id == report_id,
            Report.member_id == member.id,
        ),
    )
    if row is None:
        raise RejectedReport(404, "Report not found.")
    hazard = db.get(Hazard, row.hazard_id)
    if hazard is None or hazard.deleted_at is not None:
        raise RejectedReport(404, "Report not found.")
    return row, hazard


def _require_open(hazard: Hazard) -> None:
    """Rejects a change to a report on a resolved hazard.

    Args:
        hazard: The hazard the report describes.

    Raises:
        RejectedReport: The hazard is resolved.
    """
    if hazard.status is not HazardStatus.OPEN:
        raise RejectedReport(
            409,
            "This hazard is resolved, so its reports can no longer be "
            "changed.",
        )


def _counts(
    db: Session,
    hazard_ids: set[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """Counts the reports on each hazard.

    Args:
        db: Open database session.
        hazard_ids: Hazards to count.

    Returns:
        Hazard id to report count. A hazard with none maps to 0.
    """
    counts = dict.fromkeys(hazard_ids, 0)
    if not hazard_ids:
        return counts
    rows = db.execute(
        select(Report.hazard_id, func.count())
        .where(Report.hazard_id.in_(hazard_ids))
        .group_by(Report.hazard_id),
    ).all()
    for hazard_id, total in rows:
        counts[hazard_id] = total
    return counts


def _body(report: Report, hazard: Hazard, count: int) -> OwnReport:
    """Builds the response for one of the member's reports.

    Args:
        report: The member's report.
        hazard: The hazard it describes.
        count: How many reports describe that hazard.

    Returns:
        The report with the hazard facts the member may edit.
    """
    is_photo = report.kind is ReportKind.PHOTO
    text = report.summary if is_photo else report.description
    editable = hazard.status is HazardStatus.OPEN
    position = None
    if hazard.position_x is not None and hazard.position_y is not None:
        position = PlanPosition(x=hazard.position_x, y=hazard.position_y)
    return OwnReport(
        id=report.id,
        kind=report.kind.value,
        hazard_id=hazard.id,
        created_at=report.created_at,
        hazard_type=report.hazard_type,
        category=report.category,
        text=text or "",
        has_photo=report.image_path is not None,
        hazard_status=hazard.status,
        severity_score=hazard.severity_score,
        latitude=hazard.latitude,
        longitude=hazard.longitude,
        floor=hazard.floor,
        position=position,
        editable=editable,
        can_edit_location=editable and count == 1,
    )


def _discard(path: str) -> None:
    """Deletes a photo object, ignoring a storage failure.

    A failed delete leaves an unused object in the bucket. The database
    is already correct, so the member is not told.

    Args:
        path: Object key to delete.
    """
    try:
        service.delete_object(path)
    except StorageError:
        return
