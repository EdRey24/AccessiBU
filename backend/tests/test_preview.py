"""Preview classification route and location adjustment."""

import json

import pytest
from fastapi.testclient import TestClient

from app.reports.models import HazardType
from app.reports.preview import PreviewContext, preview_classification
from app.reports.schemas import Classification

JPEG = b"\xff\xd8\xff" + b"\x00" * 16
CONTEXT = {
    "building": "CDS",
    "floor": 3,
    "nearestFeature": {
        "kind": "stair",
        "label": "North stair",
        "distance": 0.04,
    },
}


def _classification(score: int = 80) -> Classification:
    """Returns one blockage classification.

    Args:
        score: Passage interference from 0 through 100.

    Returns:
        A blockage classification.
    """
    return Classification(
        hazard_type=HazardType.BLOCKAGE,
        category=14,
        severity_score=score,
        summary="A cart blocks the corridor.",
    )


def test_preview_adds_a_location_bonus() -> None:
    """A pin beside a stair raises the 1–10 score."""
    body = preview_classification(_classification(35), _context(0.04))
    assert body.hazard_label == "Blocked path"
    assert body.base_severity == 4
    assert body.location_bonus == 3
    assert body.severity == 7
    assert body.reason == (
        "Directly beside north stair — critical egress hazard."
    )


def test_preview_clamps_the_adjusted_score() -> None:
    """A high image score plus a bonus stays on the 1–10 scale."""
    body = preview_classification(_classification(100), _context(0.04))
    assert body.base_severity == 10
    assert body.severity == 10


def test_preview_without_a_feature_keeps_the_image_score() -> None:
    """No spatial context leaves the image score unchanged."""
    body = preview_classification(_classification(0), None)
    assert body.base_severity == 1
    assert body.location_bonus == 0
    assert body.severity == 1
    assert body.reason == "Open area — standard severity."


def test_classify_route_returns_the_preview_contract(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """POST /classify returns the camelCase preview body."""

    def fake(
        image: bytes,
        media_type: str,
        description: str | None = None,
    ) -> Classification:
        assert image.startswith(b"\xff\xd8\xff")
        assert media_type == "image/jpeg"
        assert description is None
        return _classification(35)

    monkeypatch.setattr("app.reports.router.classify", fake)
    response = client.post(
        "/classify",
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
        data={"context": json.dumps(CONTEXT)},
    )
    assert response.status_code == 200
    assert response.json() == {
        "type": "Blocked path",
        "severity": 7,
        "baseSeverity": 4,
        "locationBonus": 3,
        "description": "A cart blocks the corridor.",
        "reason": "Directly beside north stair — critical egress hazard.",
    }


def test_classify_route_uses_the_description(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The member's description is sent with the photo."""

    def fake(
        image: bytes,
        media_type: str,
        description: str | None = None,
    ) -> Classification:
        assert description == "A cart is blocking the door."
        return _classification(35)

    monkeypatch.setattr("app.reports.router.classify", fake)
    response = client.post(
        "/classify",
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
        data={"description": "  A cart is blocking the door.  "},
    )
    assert response.status_code == 200
    assert response.json()["type"] == "Blocked path"


def test_classify_route_rejects_a_bad_context(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A context that is not JSON never reaches the vision call."""
    monkeypatch.setattr(
        "app.reports.router.classify",
        lambda image, media_type, description=None: pytest.fail(
            "vision was called"
        ),
    )
    response = client.post(
        "/classify",
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
        data={"context": "not-json"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "The spatial context is not valid JSON."
    )


def test_classify_route_rejects_an_unclassified_photo(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed vision call is a 422 and stores nothing."""
    from app.reports.classify import ClassificationError

    def fail(
        image: bytes,
        media_type: str,
        description: str | None = None,
    ) -> Classification:
        raise ClassificationError("The vision call failed.")

    monkeypatch.setattr("app.reports.router.classify", fail)
    response = client.post(
        "/classify",
        files={"image": ("hazard.jpg", JPEG, "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "The photo could not be classified."


def test_classify_route_refuses_a_photo_that_is_not_a_hazard(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A refusal is a distinct 422 and stores nothing."""
    from app.reports.classify import NotAHazard

    def refuse(
        image: bytes,
        media_type: str,
        description: str | None = None,
    ) -> Classification:
        raise NotAHazard("not_a_hazard")

    monkeypatch.setattr("app.reports.router.classify", refuse)
    response = client.post(
        "/classify",
        files={"image": ("people.jpg", JPEG, "image/jpeg")},
        data={"description": "this dude"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "not_a_hazard"


def _context(distance: float) -> PreviewContext:
    """Builds a preview context with one nearby feature.

    Args:
        distance: Normalized distance from the pin.

    Returns:
        A preview context.
    """
    return PreviewContext.model_validate(
        {
            "nearestFeature": {
                "label": "North stair",
                "distance": distance,
            },
        },
    )
