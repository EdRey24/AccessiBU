"""Preview classification for a photo that is not stored yet.

The vision call stays image-only. This module turns that result into
the 1–10 score the report screen shows, then adds a location adjustment
from the spatial context the app already resolved.
"""

import json

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.reports.models import HazardType
from app.reports.schemas import Classification

_BESIDE = 0.06
_CLOSE = 0.12
_NEAR = 0.22
_OPEN_AREA = "Open area — standard severity."
_LABELS = {
    HazardType.SPILL: "Spill",
    HazardType.BLOCKAGE: "Blocked path",
    HazardType.ELEVATOR: "Broken elevator",
    HazardType.ENTRANCE: "Broken door",
    HazardType.WALKING_SURFACE: "Wet floor",
    HazardType.OTHER: "Other",
}


class PreviewContextError(Exception):
    """The spatial context was not a usable object."""


class NearbyFeature(BaseModel):
    """One floor-plan feature the pin was measured against.

    Attributes:
        label: Name shown on the floor plan.
        distance: Normalized distance from the pin, 0 through 1.
    """

    model_config = ConfigDict(extra="ignore")

    label: str = Field(min_length=1)
    distance: float = Field(ge=0)


class PreviewContext(BaseModel):
    """The part of a spatial context this preview reads.

    Attributes:
        nearest_feature: Closest stair, elevator, or entrance.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    nearest_feature: NearbyFeature | None = Field(
        default=None,
        alias="nearestFeature",
    )


class PreviewClassification(BaseModel):
    """The body returned by POST /classify.

    Attributes:
        hazard_label: Display name the report screen shows as type.
        severity: Location-adjusted score from 1 through 10.
        base_severity: Image-only score from 1 through 10.
        location_bonus: Points added for a nearby egress feature.
        description: Short account of the photo.
        reason: Why the location changed the score.
    """

    model_config = ConfigDict(populate_by_name=True)

    hazard_label: str = Field(alias="type")
    severity: int = Field(ge=1, le=10)
    base_severity: int = Field(ge=1, le=10, alias="baseSeverity")
    location_bonus: int = Field(alias="locationBonus")
    description: str = Field(min_length=1)
    reason: str = Field(min_length=1)


def load_preview_context(raw: str | None) -> PreviewContext | None:
    """Reads the optional context field from the preview form.

    Args:
        raw: JSON string of a spatial context, or nothing.

    Returns:
        The nearest feature, or None when no context was sent.

    Raises:
        PreviewContextError: The field is not a spatial context.
    """
    if raw is None or raw.strip() == "":
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise PreviewContextError(
            "The spatial context is not valid JSON.",
        ) from error
    if payload is None:
        return None
    try:
        return PreviewContext.model_validate(payload)
    except ValidationError as error:
        raise PreviewContextError(
            "The spatial context is incomplete.",
        ) from error


def preview_classification(
    classification: Classification,
    context: PreviewContext | None,
) -> PreviewClassification:
    """Builds the preview body from a vision result and a pin.

    Args:
        classification: The image-only vision result.
        context: Nearest floor-plan feature, when the app sent one.

    Returns:
        A 1–10 score with the location adjustment applied.
    """
    base = image_severity(classification.severity_score)
    bonus, reason = location_adjustment(context)
    severity = base + bonus
    if severity < 1:
        severity = 1
    if severity > 10:
        severity = 10
    return PreviewClassification(
        hazard_label=_LABELS[classification.hazard_type],
        severity=severity,
        base_severity=base,
        location_bonus=bonus,
        description=classification.summary,
        reason=reason,
    )


def image_severity(score: int) -> int:
    """Maps a 0–100 passage score onto the 1–10 preview scale.

    Half scores round away from zero, matching the pin color scale.

    Args:
        score: Passage interference from 0 through 100.

    Returns:
        A score from 1 through 10.
    """
    rounded = int(score / 10 + 0.5)
    if rounded < 1:
        return 1
    if rounded > 10:
        return 10
    return rounded


def location_adjustment(
    context: PreviewContext | None,
) -> tuple[int, str]:
    """Scores how close the pin is to an egress feature.

    Args:
        context: Nearest floor-plan feature, when the app sent one.

    Returns:
        The bonus, from 0 through 3, and the sentence that explains it.
    """
    feature = None if context is None else context.nearest_feature
    if feature is None:
        return 0, _OPEN_AREA
    label = feature.label.strip().lower() or "a feature"
    if feature.distance <= _BESIDE:
        return (
            3,
            f"Directly beside {label} — critical egress hazard.",
        )
    if feature.distance <= _CLOSE:
        return 2, f"Close to {label} — elevated risk."
    if feature.distance <= _NEAR:
        return 1, f"Near {label}."
    return 0, _OPEN_AREA
