"""Facilities actions on hazards.

A resolve records who closed the hazard and when. A delete stamps
deleted_at and keeps every row and photo, so it can be undone by
clearing the column.
"""

import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.schemas import AdminHazard
from app.hazards.models import Hazard, HazardStatus
from app.members.models import Member
from app.reports.models import Report
from app.reports.service import RejectedReport, report_summaries

StatusFilter = Literal["open", "resolved", "all"]


def list_hazards(db: Session, status: StatusFilter) -> list[AdminHazard]:
    """Lists hazards that have not been deleted, newest first.

    Args:
        db: Open database session.
        status: Which hazards to include.

    Returns:
        The matching hazards with their type, summary, and report count.
    """
    statement = select(Hazard).where(Hazard.deleted_at.is_(None))
    if status != "all":
        statement = statement.where(Hazard.status == HazardStatus(status))
    rows = list(db.scalars(statement.order_by(Hazard.created_at.desc())).all())
    return admin_bodies(db, rows)


def resolve_hazard(
    db: Session,
    hazard_id: uuid.UUID,
    admin: Member,
) -> AdminHazard:
    """Marks a hazard resolved.

    Resolving a hazard that is already resolved changes nothing, so the
    first resolver and time are kept.

    Args:
        db: Open database session.
        hazard_id: The hazard to resolve.
        admin: The admin who is resolving it.

    Returns:
        The hazard after the change.

    Raises:
        RejectedReport: No hazard has that id, or it was deleted.
    """
    hazard = _require_live(db, hazard_id)
    if hazard.status is not HazardStatus.RESOLVED:
        hazard.status = HazardStatus.RESOLVED
        hazard.resolved_at = datetime.now(UTC)
        hazard.resolved_by = admin.id
        db.commit()
        db.refresh(hazard)
    return admin_bodies(db, [hazard])[0]


def delete_hazard(db: Session, hazard_id: uuid.UUID) -> None:
    """Hides a hazard from every route without removing any data.

    Args:
        db: Open database session.
        hazard_id: The hazard to delete.

    Raises:
        RejectedReport: No hazard has that id, or it was deleted.
    """
    hazard = _require_live(db, hazard_id)
    hazard.deleted_at = datetime.now(UTC)
    db.commit()


def admin_bodies(db: Session, rows: list[Hazard]) -> list[AdminHazard]:
    """Copies hazard rows and attaches type, summary, and report count.

    Args:
        db: Open database session.
        rows: Hazard rows to return.

    Returns:
        One response model per row, in the same order.
    """
    ids = [row.id for row in rows]
    summaries = report_summaries(db, ids)
    types: dict[uuid.UUID, Report] = {}
    counts: Counter[uuid.UUID] = Counter()
    if ids:
        reports = db.scalars(
            select(Report)
            .where(Report.hazard_id.in_(ids))
            .order_by(Report.created_at.asc()),
        ).all()
        for report in reports:
            types[report.hazard_id] = report
            counts[report.hazard_id] += 1
    bodies: list[AdminHazard] = []
    for row in rows:
        latest = types.get(row.id)
        body = AdminHazard.model_validate(row)
        bodies.append(
            body.model_copy(
                update={
                    "summary": summaries.get(row.id),
                    "hazard_type": (
                        None if latest is None else latest.hazard_type
                    ),
                    "report_count": counts[row.id],
                },
            ),
        )
    return bodies


def _require_live(db: Session, hazard_id: uuid.UUID) -> Hazard:
    """Loads a hazard that exists and has not been deleted.

    Args:
        db: Open database session.
        hazard_id: The hazard to load.

    Returns:
        The hazard.

    Raises:
        RejectedReport: No hazard has that id, or it was deleted.
    """
    hazard = db.get(Hazard, hazard_id)
    if hazard is None or hazard.deleted_at is not None:
        raise RejectedReport(404, "Hazard not found.")
    return hazard
