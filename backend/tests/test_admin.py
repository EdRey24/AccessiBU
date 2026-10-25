"""Facilities routes: access control, resolve, and soft delete."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.members.deps import current_member
from app.members.models import Member, MemberRole

MEMBER_ID = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
PLACE = {"latitude": 42.35, "longitude": -71.1}


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """Signs the test client in as an admin.

    Args:
        client: The API client, signed in as a plain member.

    Returns:
        The same client, now acting as an admin.
    """

    def override_admin() -> Member:
        return Member(
            id=MEMBER_ID,
            email="ada@bu.edu",
            role=MemberRole.ADMIN,
            mobility_preference=False,
        )

    app.dependency_overrides[current_member] = override_admin
    return client


def _report(client: TestClient, severity: int = 60) -> str:
    """Opens a hazard with a text report.

    Args:
        client: A signed-in client.
        severity: Severity score for the new hazard.

    Returns:
        The id of the new hazard.
    """
    response = client.post(
        "/reports/text",
        json={
            **PLACE,
            "hazard_type": "elevator",
            "category": 3,
            "description": "Elevator is out",
            "severity_score": severity,
        },
    )
    assert response.status_code == 201
    return response.json()["hazard_id"]


def test_member_cannot_use_admin_routes(client: TestClient) -> None:
    """A plain member gets 403 on every Facilities route."""
    hazard_id = _report(client)
    assert client.get("/admin/hazards").status_code == 403
    resolved = client.post(f"/admin/hazards/{hazard_id}/resolve")
    assert resolved.status_code == 403
    reopened = client.post(f"/admin/hazards/{hazard_id}/reopen")
    assert reopened.status_code == 403
    assert client.delete(f"/admin/hazards/{hazard_id}").status_code == 403
    still_open = client.get(f"/hazards/{hazard_id}").json()
    assert still_open["status"] == "open"


def test_admin_routes_require_a_session() -> None:
    """A request without a token is rejected."""
    with TestClient(app) as anonymous:
        listed = anonymous.get("/admin/hazards")
        resolved = anonymous.post(f"/admin/hazards/{uuid.uuid4()}/resolve")
        deleted = anonymous.delete(f"/admin/hazards/{uuid.uuid4()}")
    for response in (listed, resolved, deleted):
        assert response.status_code in {401, 403}


def test_admin_lists_hazards_with_type_and_count(admin: TestClient) -> None:
    """The admin list carries the type, summary, and report count."""
    hazard_id = _report(admin)
    admin.post(
        "/reports/text",
        json={
            "hazard_id": hazard_id,
            "hazard_type": "elevator",
            "category": 3,
            "description": "Still out",
            "severity_score": 70,
        },
    )
    listed = admin.get("/admin/hazards")
    assert listed.status_code == 200
    [row] = listed.json()
    assert row["id"] == hazard_id
    assert row["hazard_type"] == "elevator"
    assert row["report_count"] == 2
    assert row["summary"] == "Still out"
    assert row["severity_score"] == 70
    assert row["resolved_at"] is None


def test_resolve_marks_the_hazard_and_filters(admin: TestClient) -> None:
    """A resolve closes the hazard and the status filter finds it."""
    open_id = _report(admin)
    resolved_id = _report(admin, severity=20)

    response = admin.post(f"/admin/hazards/{resolved_id}/resolve")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "resolved"
    assert body["resolved_at"] is not None

    open_only = admin.get("/admin/hazards", params={"status": "open"}).json()
    assert [row["id"] for row in open_only] == [open_id]
    done = admin.get("/admin/hazards", params={"status": "resolved"}).json()
    assert [row["id"] for row in done] == [resolved_id]
    everything = admin.get("/admin/hazards").json()
    assert {row["id"] for row in everything} == {open_id, resolved_id}

    members_see = admin.get("/hazards").json()
    assert [row["id"] for row in members_see] == [open_id]


def test_resolve_twice_keeps_the_first_time(admin: TestClient) -> None:
    """Resolving again is allowed and changes nothing."""
    hazard_id = _report(admin)
    first = admin.post(f"/admin/hazards/{hazard_id}/resolve").json()
    second = admin.post(f"/admin/hazards/{hazard_id}/resolve")
    assert second.status_code == 200
    assert second.json()["resolved_at"] == first["resolved_at"]


def test_reopen_undoes_a_resolve(admin: TestClient) -> None:
    """A reopen makes the hazard open again for everyone."""
    hazard_id = _report(admin)
    admin.post(f"/admin/hazards/{hazard_id}/resolve")
    assert admin.get("/hazards").json() == []

    response = admin.post(f"/admin/hazards/{hazard_id}/reopen")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    assert body["resolved_at"] is None
    assert [row["id"] for row in admin.get("/hazards").json()] == [hazard_id]
    open_only = admin.get("/admin/hazards", params={"status": "open"}).json()
    assert [row["id"] for row in open_only] == [hazard_id]

    again = admin.post(f"/admin/hazards/{hazard_id}/resolve")
    assert again.status_code == 200
    assert again.json()["resolved_at"] is not None


def test_reopen_an_open_hazard_changes_nothing(admin: TestClient) -> None:
    """Reopening a hazard that is open is allowed and harmless."""
    hazard_id = _report(admin)
    response = admin.post(f"/admin/hazards/{hazard_id}/reopen")
    assert response.status_code == 200
    assert response.json()["status"] == "open"


def test_reopened_hazard_takes_reports_again(admin: TestClient) -> None:
    """After a reopen, members can attach reports again."""
    hazard_id = _report(admin)
    admin.post(f"/admin/hazards/{hazard_id}/resolve")
    admin.post(f"/admin/hazards/{hazard_id}/reopen")
    response = admin.post(
        "/reports/text",
        json={
            "hazard_id": hazard_id,
            "hazard_type": "elevator",
            "category": 3,
            "description": "Out again",
            "severity_score": 90,
        },
    )
    assert response.status_code == 201


def test_resolved_hazard_takes_no_new_report(admin: TestClient) -> None:
    """A resolved hazard stays resolved."""
    hazard_id = _report(admin)
    admin.post(f"/admin/hazards/{hazard_id}/resolve")
    response = admin.post(
        "/reports/text",
        json={
            "hazard_id": hazard_id,
            "hazard_type": "elevator",
            "category": 3,
            "description": "Out again",
            "severity_score": 90,
        },
    )
    assert response.status_code == 409


def test_delete_hides_the_hazard_everywhere(admin: TestClient) -> None:
    """A deleted hazard disappears from member and admin routes."""
    hazard_id = _report(admin)
    kept_id = _report(admin)

    response = admin.delete(f"/admin/hazards/{hazard_id}")
    assert response.status_code == 204

    assert [row["id"] for row in admin.get("/hazards").json()] == [kept_id]
    listed = admin.get("/admin/hazards").json()
    assert [row["id"] for row in listed] == [kept_id]
    assert admin.get(f"/hazards/{hazard_id}").status_code == 404
    assert admin.get(f"/hazards/{hazard_id}/reports").status_code == 404
    assert admin.get(f"/hazards/{hazard_id}/photo").status_code == 404
    attach = admin.post(
        "/reports/text",
        json={
            "hazard_id": hazard_id,
            "hazard_type": "elevator",
            "category": 3,
            "description": "Late report",
            "severity_score": 10,
        },
    )
    assert attach.status_code == 404


def test_delete_keeps_the_reports(admin: TestClient, sessions) -> None:
    """A delete is soft: the report rows are still in the database."""
    from sqlalchemy import select

    from app.hazards.models import Hazard
    from app.reports.models import Report

    hazard_id = _report(admin)
    admin.delete(f"/admin/hazards/{hazard_id}")
    with sessions() as session:
        hazard = session.get(Hazard, uuid.UUID(hazard_id))
        assert hazard is not None
        assert hazard.deleted_at is not None
        reports = session.scalars(
            select(Report).where(Report.hazard_id == hazard.id),
        ).all()
        assert len(reports) == 1


def test_missing_hazard_is_not_found(admin: TestClient) -> None:
    """Resolving or deleting an unknown or deleted hazard is a 404."""
    missing = uuid.uuid4()
    assert admin.post(f"/admin/hazards/{missing}/resolve").status_code == 404
    assert admin.delete(f"/admin/hazards/{missing}").status_code == 404
    assert admin.post(f"/admin/hazards/{missing}/reopen").status_code == 404

    hazard_id = _report(admin)
    admin.delete(f"/admin/hazards/{hazard_id}")
    assert admin.delete(f"/admin/hazards/{hazard_id}").status_code == 404
    resolved = admin.post(f"/admin/hazards/{hazard_id}/resolve")
    assert resolved.status_code == 404
    reopened = admin.post(f"/admin/hazards/{hazard_id}/reopen")
    assert reopened.status_code == 404


def test_bad_status_filter_is_rejected(admin: TestClient) -> None:
    """An unknown status value is a 422."""
    response = admin.get("/admin/hazards", params={"status": "bogus"})
    assert response.status_code == 422
