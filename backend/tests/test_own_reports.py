"""A member's own reports: list, edit, replace the photo, and delete.

The core rule is strict ownership. Another member, and even an admin,
gets a 404 on every route for a report they did not submit, and the
report is left untouched.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.hazards.models import Hazard, HazardStatus
from app.main import app
from app.members.deps import current_member
from app.members.models import Member, MemberRole
from app.reports.models import HazardType
from app.reports.schemas import Classification

OWNER_ID = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
OTHER_ID = uuid.UUID("bbbbbbbb-2222-4222-8222-222222222222")
ADMIN_ID = uuid.UUID("cccccccc-3333-4333-8333-333333333333")
JPEG = b"\xff\xd8\xff" + b"\x00" * 16
NEW_JPEG = b"\xff\xd8\xff" + b"\x01" * 16
PLACE = {"latitude": 42.35, "longitude": -71.1}
EDIT_PLACE = {
    "latitude": 42.36,
    "longitude": -71.2,
    "floor": 2,
    "position_x": 0.4,
    "position_y": 0.6,
}


@pytest.fixture(autouse=True)
def _vision(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stands in for the vision call.

    Args:
        monkeypatch: Pytest patch helper.
    """
    monkeypatch.setattr(
        "app.reports.service._classify",
        lambda image, media_type, description=None: Classification(
            hazard_type=HazardType.BLOCKAGE,
            category=14,
            severity_score=8,
            summary="A cart blocks the east entrance.",
        ),
    )


@pytest.fixture
def people(client: TestClient, sessions) -> None:
    """Adds a second member and an admin to the database.

    Args:
        client: The API client, which also resets the database.
        sessions: The session factory bound to the test database.
    """
    with sessions() as session:
        for member_id, email, role in (
            (OTHER_ID, "grace@bu.edu", MemberRole.MEMBER),
            (ADMIN_ID, "root@bu.edu", MemberRole.ADMIN),
        ):
            session.execute(
                text("INSERT INTO auth.users (id) VALUES (:id)"),
                {"id": str(member_id)},
            )
            session.add(
                Member(
                    id=member_id,
                    email=email,
                    role=role,
                    mobility_preference=False,
                ),
            )
        session.commit()


def _act_as(member_id: uuid.UUID, role: MemberRole = MemberRole.MEMBER) -> None:
    """Signs the test client in as another member.

    Args:
        member_id: The member the token should name.
        role: The role that member holds.
    """
    app.dependency_overrides[current_member] = lambda: Member(
        id=member_id,
        email=f"{member_id.hex[:6]}@bu.edu",
        role=role,
        mobility_preference=False,
    )


def _text_report(client: TestClient, **extra: object) -> dict:
    """Opens a hazard with a text report.

    Args:
        client: A signed-in client.
        **extra: Fields that replace the defaults.

    Returns:
        The stored report body.
    """
    body = {
        **PLACE,
        "hazard_type": "spill",
        "category": 2,
        "description": "Wet floor by the door",
        "severity_score": 4,
        **extra,
    }
    response = client.post("/reports/text", json=body)
    assert response.status_code == 201
    return response.json()


def _photo_report(client: TestClient) -> dict:
    """Opens a hazard with a photo report.

    Args:
        client: A signed-in client.

    Returns:
        The stored report body.
    """
    response = client.post(
        "/reports/photo",
        data=PLACE,
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 201
    return response.json()


def _mine(client: TestClient) -> list[dict]:
    """Lists the signed-in member's reports.

    Args:
        client: A signed-in client.

    Returns:
        The response rows.
    """
    response = client.get("/reports/mine")
    assert response.status_code == 200
    return response.json()


def test_mine_lists_only_the_members_own_reports(
    client: TestClient,
    people: None,
) -> None:
    """Each member sees their own reports and nobody else's."""
    mine = _text_report(client)
    _act_as(OTHER_ID)
    theirs = _text_report(client, description="Broken door")

    assert [row["id"] for row in _mine(client)] == [theirs["id"]]
    _act_as(OWNER_ID)
    rows = _mine(client)
    assert [row["id"] for row in rows] == [mine["id"]]
    assert rows[0]["text"] == "Wet floor by the door"
    assert rows[0]["editable"] is True
    assert rows[0]["can_edit_location"] is True


def test_owner_edits_text_type_and_location(client: TestClient) -> None:
    """The owner can change the text, the type, and the pin."""
    report = _text_report(client)
    response = client.patch(
        f"/reports/{report['id']}",
        json={
            "description": "  Mopped, still damp  ",
            "hazard_type": "walking_surface",
            "location": EDIT_PLACE,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Mopped, still damp"
    assert body["hazard_type"] == "walking_surface"
    assert body["floor"] == 2
    assert body["position"] == {"x": 0.4, "y": 0.6}

    hazard = client.get(f"/hazards/{report['hazard_id']}").json()
    assert hazard["latitude"] == 42.36
    assert hazard["floor"] == 2
    assert hazard["summary"] == "Mopped, still damp"
    stored = client.get(f"/hazards/{report['hazard_id']}/reports").json()
    assert stored[0]["hazard_type"] == "walking_surface"
    assert stored[0]["description"] == "Mopped, still damp"


def test_photo_report_text_edit_changes_its_summary(
    client: TestClient,
) -> None:
    """A photo report keeps edited text as its summary."""
    report = _photo_report(client)
    response = client.patch(
        f"/reports/{report['id']}",
        json={"description": "Cart moved, door clear"},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Cart moved, door clear"
    stored = client.get(f"/hazards/{report['hazard_id']}/reports").json()
    assert stored[0]["summary"] == "Cart moved, door clear"


def test_edit_does_not_change_severity_or_status(client: TestClient) -> None:
    """An edit leaves the severity and status alone."""
    report = _text_report(client, severity_score=6)
    client.patch(f"/reports/{report['id']}", json={"description": "Updated"})
    hazard = client.get(f"/hazards/{report['hazard_id']}").json()
    assert hazard["severity_score"] == 6
    assert hazard["status"] == "open"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"description": "   "},
        {"description": "x" * 1001},
        {"hazard_type": "puddle"},
        {"status": "resolved", "description": "x"},
        {"member_id": str(OTHER_ID), "description": "x"},
        {"hazard_id": str(uuid.uuid4()), "description": "x"},
        {"severity_score": 5, "description": "x"},
        {"location": {"latitude": 1, "longitude": 1, "position_x": 0.5}},
        {"location": {"latitude": 99, "longitude": 1}},
    ],
)
def test_edit_rejects_bad_or_unknown_fields(
    client: TestClient,
    payload: dict,
) -> None:
    """Only the three editable fields are accepted, and they are checked."""
    report = _text_report(client)
    response = client.patch(f"/reports/{report['id']}", json=payload)
    assert response.status_code == 422
    unchanged = _mine(client)[0]
    assert unchanged["text"] == "Wet floor by the door"
    assert unchanged["hazard_status"] == "open"


def test_another_member_cannot_edit_the_report(
    client: TestClient,
    people: None,
) -> None:
    """A different member gets a 404 and nothing changes."""
    report = _text_report(client)
    _act_as(OTHER_ID)
    response = client.patch(
        f"/reports/{report['id']}",
        json={
            "description": "Hijacked",
            "hazard_type": "other",
            "location": EDIT_PLACE,
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Report not found."

    _act_as(OWNER_ID)
    untouched = _mine(client)[0]
    assert untouched["text"] == "Wet floor by the door"
    assert untouched["hazard_type"] == "spill"
    assert untouched["latitude"] == PLACE["latitude"]


def test_another_member_cannot_delete_the_report(
    client: TestClient,
    people: None,
) -> None:
    """A different member cannot delete the report."""
    report = _text_report(client)
    _act_as(OTHER_ID)
    assert client.delete(f"/reports/{report['id']}").status_code == 404

    _act_as(OWNER_ID)
    assert [row["id"] for row in _mine(client)] == [report["id"]]
    assert client.get(f"/hazards/{report['hazard_id']}").status_code == 200


def test_another_member_cannot_touch_the_photo(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
    people: None,
) -> None:
    """A different member cannot read or replace the photo."""
    report = _photo_report(client)
    before = dict(objects)
    _act_as(OTHER_ID)
    assert client.get(f"/reports/{report['id']}/photo").status_code == 404
    replaced = client.put(
        f"/reports/{report['id']}/photo",
        files={"image": ("new.jpg", NEW_JPEG, "image/jpeg")},
    )
    assert replaced.status_code == 404
    assert objects == before


def test_an_admin_is_not_an_exception(
    client: TestClient,
    people: None,
) -> None:
    """Admins cannot edit or delete a member's report through these routes."""
    report = _text_report(client)
    _act_as(ADMIN_ID, MemberRole.ADMIN)
    patch = client.patch(
        f"/reports/{report['id']}",
        json={"description": "Admin edit"},
    )
    assert patch.status_code == 404
    assert client.delete(f"/reports/{report['id']}").status_code == 404
    assert _mine(client) == []

    _act_as(OWNER_ID)
    assert _mine(client)[0]["text"] == "Wet floor by the door"


def test_unknown_report_is_not_found(client: TestClient) -> None:
    """An id that does not exist is the same 404 as someone else's."""
    missing = uuid.uuid4()
    assert client.patch(
        f"/reports/{missing}",
        json={"description": "x"},
    ).status_code == 404
    assert client.delete(f"/reports/{missing}").status_code == 404
    assert client.get(f"/reports/{missing}/photo").status_code == 404


def test_report_routes_require_a_session() -> None:
    """A request without a token is rejected."""
    report_id = uuid.uuid4()
    with TestClient(app) as anonymous:
        responses = [
            anonymous.get("/reports/mine"),
            anonymous.patch(f"/reports/{report_id}", json={"description": "x"}),
            anonymous.delete(f"/reports/{report_id}"),
            anonymous.get(f"/reports/{report_id}/photo"),
        ]
    for response in responses:
        assert response.status_code in {401, 403}


def test_shared_hazard_location_cannot_be_moved(
    client: TestClient,
    people: None,
) -> None:
    """With another member's report on the hazard, the pin is locked."""
    report = _text_report(client)
    _act_as(OTHER_ID)
    other = client.post(
        "/reports/text",
        json={
            "hazard_id": report["hazard_id"],
            "hazard_type": "spill",
            "category": 2,
            "description": "I saw it too",
            "severity_score": 5,
        },
    )
    assert other.status_code == 201

    _act_as(OWNER_ID)
    row = _mine(client)[0]
    assert row["editable"] is True
    assert row["can_edit_location"] is False
    moved = client.patch(
        f"/reports/{report['id']}",
        json={"location": EDIT_PLACE},
    )
    assert moved.status_code == 409
    hazard = client.get(f"/hazards/{report['hazard_id']}").json()
    assert hazard["latitude"] == PLACE["latitude"]
    text_only = client.patch(
        f"/reports/{report['id']}",
        json={"description": "Still wet"},
    )
    assert text_only.status_code == 200


def test_resolved_hazard_freezes_its_reports(
    client: TestClient,
    sessions,
) -> None:
    """Once Facilities resolve a hazard, its reports cannot change."""
    report = _photo_report(client)
    with sessions() as session:
        hazard = session.get(Hazard, uuid.UUID(report["hazard_id"]))
        assert hazard is not None
        hazard.status = HazardStatus.RESOLVED
        session.commit()

    row = _mine(client)[0]
    assert row["editable"] is False
    assert row["can_edit_location"] is False
    path = f"/reports/{report['id']}"
    assert client.patch(path, json={"description": "x"}).status_code == 409
    assert client.delete(path).status_code == 409
    photo = client.put(
        f"{path}/photo",
        files={"image": ("new.jpg", NEW_JPEG, "image/jpeg")},
    )
    assert photo.status_code == 409


def test_deleting_the_only_report_hides_the_hazard(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
) -> None:
    """The last report takes its photo and its empty hazard with it."""
    report = _photo_report(client)
    assert len(objects) == 1
    response = client.delete(f"/reports/{report['id']}")
    assert response.status_code == 204
    assert objects == {}
    assert _mine(client) == []
    assert client.get("/hazards").json() == []
    assert client.get(f"/hazards/{report['hazard_id']}").status_code == 404


def test_deleting_one_of_two_reports_keeps_the_hazard(
    client: TestClient,
    people: None,
) -> None:
    """The hazard stays while another member's report remains."""
    report = _text_report(client)
    _act_as(OTHER_ID)
    other = client.post(
        "/reports/text",
        json={
            "hazard_id": report["hazard_id"],
            "hazard_type": "spill",
            "category": 2,
            "description": "I saw it too",
            "severity_score": 5,
        },
    ).json()

    _act_as(OWNER_ID)
    assert client.delete(f"/reports/{report['id']}").status_code == 204
    assert client.get(f"/hazards/{report['hazard_id']}").status_code == 200
    remaining = client.get(f"/hazards/{report['hazard_id']}/reports").json()
    assert [row["id"] for row in remaining] == [other["id"]]
    _act_as(OTHER_ID)
    assert _mine(client)[0]["can_edit_location"] is True


def test_owner_reads_and_replaces_the_photo(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
) -> None:
    """A new photo replaces the old object and is served back."""
    report = _photo_report(client)
    old_keys = set(objects)
    shown = client.get(f"/reports/{report['id']}/photo")
    assert shown.status_code == 200
    assert shown.content == JPEG

    response = client.put(
        f"/reports/{report['id']}/photo",
        files={"image": ("new.jpg", NEW_JPEG, "image/jpeg")},
    )
    assert response.status_code == 200
    assert set(objects).isdisjoint(old_keys)
    assert len(objects) == 1
    assert client.get(f"/reports/{report['id']}/photo").content == NEW_JPEG
    hazard_photo = client.get(f"/hazards/{report['hazard_id']}/photo")
    assert hazard_photo.content == NEW_JPEG


def test_bad_replacement_photo_changes_nothing(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
) -> None:
    """A file that is not a photo leaves the stored photo alone."""
    report = _photo_report(client)
    before = dict(objects)
    response = client.put(
        f"/reports/{report['id']}/photo",
        files={"image": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert objects == before


def test_text_report_has_no_photo_to_replace(client: TestClient) -> None:
    """Only a photo report can take a new photo."""
    report = _text_report(client)
    response = client.put(
        f"/reports/{report['id']}/photo",
        files={"image": ("new.jpg", NEW_JPEG, "image/jpeg")},
    )
    assert response.status_code == 409
    assert client.get(f"/reports/{report['id']}/photo").status_code == 404
