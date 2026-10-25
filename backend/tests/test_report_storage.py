"""End-to-end storage of text and photo reports."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.reports.models import HazardType
from app.reports.schemas import Classification
from app.reports.service import MAX_IMAGE_BYTES

MEMBER_ID = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
JPEG = b"\xff\xd8\xff" + b"\x00" * 16
PLACE = {"latitude": 42.35, "longitude": -71.1}


def _classification() -> Classification:
    """Returns one finished vision result.

    Returns:
        A blockage classification.
    """
    return Classification(
        hazard_type=HazardType.BLOCKAGE,
        category=14,
        severity_score=80,
        summary="A cart blocks the east entrance.",
    )


def test_text_report_opens_a_hazard(client: TestClient) -> None:
    """A text submission stores the report and the hazard score."""
    response = client.post(
        "/reports/text",
        json={
            **PLACE,
            "hazard_type": "spill",
            "category": 2,
            "description": "  Wet floor by the door  ",
            "severity_score": 40,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "text"
    assert body["description"] == "Wet floor by the door"
    assert body["member_id"] == str(MEMBER_ID)
    hazard_id = body["hazard_id"]

    hazard = client.get(f"/hazards/{hazard_id}")
    assert hazard.status_code == 200
    assert hazard.json()["severity_score"] == 40
    assert hazard.json()["status"] == "open"

    reports = client.get(f"/hazards/{hazard_id}/reports")
    assert reports.status_code == 200
    assert reports.json()[0]["category"] == 2


def test_text_report_stores_the_pin(client: TestClient) -> None:
    """A text submission keeps the floor and plan pin on the hazard."""
    response = client.post(
        "/reports/text",
        json={
            **PLACE,
            "hazard_type": "spill",
            "category": 2,
            "description": "Wet floor by the stair",
            "severity_score": 40,
            "floor": 2,
            "position_x": 0.25,
            "position_y": 0.75,
        },
    )
    assert response.status_code == 201
    hazard = client.get(f"/hazards/{response.json()['hazard_id']}")
    assert hazard.status_code == 200
    assert hazard.json()["floor"] == 2
    assert hazard.json()["position"] == {"x": 0.25, "y": 0.75}


def test_text_report_requires_a_place(client: TestClient) -> None:
    """A new hazard without coordinates is rejected."""
    response = client.post(
        "/reports/text",
        json={
            "hazard_type": "spill",
            "category": 2,
            "description": "Wet floor",
            "severity_score": 40,
        },
    )
    assert response.status_code == 422


def test_second_report_replaces_severity(client: TestClient) -> None:
    """The hazard keeps the latest submission's score."""
    opened = client.post(
        "/reports/text",
        json={
            **PLACE,
            "hazard_type": "spill",
            "category": 2,
            "description": "Wet floor",
            "severity_score": 90,
        },
    )
    hazard_id = opened.json()["hazard_id"]
    attached = client.post(
        "/reports/text",
        json={
            "hazard_id": hazard_id,
            "hazard_type": "spill",
            "category": 2,
            "description": "Mostly dry",
            "severity_score": 15,
        },
    )
    assert attached.status_code == 201
    hazard = client.get(f"/hazards/{hazard_id}")
    assert hazard.json()["severity_score"] == 15
    reports = client.get(f"/hazards/{hazard_id}/reports")
    assert len(reports.json()) == 2


def test_resolved_hazard_rejects_a_report(
    client: TestClient,
    sessions,
) -> None:
    """A resolved hazard does not take another report."""
    from app.hazards.models import Hazard, HazardStatus

    opened = client.post(
        "/reports/text",
        json={
            **PLACE,
            "hazard_type": "entrance",
            "category": 1,
            "description": "Door stuck",
            "severity_score": 70,
        },
    )
    hazard_id = uuid.UUID(opened.json()["hazard_id"])
    with sessions() as session:
        hazard = session.get(Hazard, hazard_id)
        assert hazard is not None
        hazard.status = HazardStatus.RESOLVED
        session.commit()
    response = client.post(
        "/reports/text",
        json={
            "hazard_id": str(hazard_id),
            "hazard_type": "entrance",
            "category": 1,
            "description": "Still stuck",
            "severity_score": 70,
        },
    )
    assert response.status_code == 409


def test_photo_report_stores_the_classification(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A photo is stored only with the vision call's fields."""
    monkeypatch.setattr(
        "app.reports.service._classify",
        lambda image, media_type: _classification(),
    )
    response = client.post(
        "/reports/photo",
        data=PLACE,
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "photo"
    assert body["hazard_type"] == "blockage"
    assert body["category"] == 14
    assert body["summary"] == "A cart blocks the east entrance."
    assert body["image_path"] in objects
    assert objects[body["image_path"]][1] == "image/jpeg"
    hazard = client.get(f"/hazards/{body['hazard_id']}")
    assert hazard.json()["severity_score"] == 80


def test_bad_photo_is_rejected(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
) -> None:
    """A file that is not a photo is not stored."""
    response = client.post(
        "/reports/photo",
        data=PLACE,
        files={"image": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert objects == {}


def test_oversize_photo_is_rejected(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A photo over the size limit is rejected."""
    monkeypatch.setattr("app.reports.service.MAX_IMAGE_BYTES", 8)
    response = client.post(
        "/reports/photo",
        data=PLACE,
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 413
    assert len(JPEG) > 8
    assert MAX_IMAGE_BYTES > 8


def test_failed_classification_deletes_the_object(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed vision call leaves no object and no report."""

    def fail(image: bytes, media_type: str) -> Classification:
        raise RuntimeError("vision")

    monkeypatch.setattr("app.reports.service._classify", fail)
    monkeypatch.setattr(
        "app.reports.service._classification_failed",
        lambda error: True,
    )
    response = client.post(
        "/reports/photo",
        data=PLACE,
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 422
    assert objects == {}
    assert client.get("/hazards").json() == []


def test_failed_commit_deletes_the_object(
    client: TestClient,
    objects: dict[str, tuple[bytes, str]],
    state: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A database failure deletes the uploaded photo."""
    monkeypatch.setattr(
        "app.reports.service._classify",
        lambda image, media_type: _classification(),
    )
    state["fail_commit"] = True
    with pytest.raises(RuntimeError, match="disk"):
        client.post(
            "/reports/photo",
            data=PLACE,
            files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
        )
    assert objects == {}


def test_missing_hazard_is_not_found(client: TestClient) -> None:
    """An unknown hazard id is a 404."""
    missing = uuid.uuid4()
    response = client.get(f"/hazards/{missing}")
    assert response.status_code == 404


def test_reports_require_a_member() -> None:
    """A request without a session is rejected."""
    from app.main import app

    with TestClient(app) as anonymous:
        response = anonymous.get("/hazards")
    assert response.status_code in {401, 403}
