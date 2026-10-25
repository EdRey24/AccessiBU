"""The one vision call for a photo.

The call returns a classification. It does not store a report, upload
an object, or send an alert.
"""

import base64
import json

import httpx
from pydantic import ValidationError

from app.config import get_settings
from app.reports.models import HazardType
from app.reports.schemas import Classification

_TIMEOUT_SECONDS = 30.0
_ACCEPTED_MEDIA_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/heic"}
)
_REQUIRED = frozenset(
    {"hazard_type", "category", "severity_score", "summary"}
)
PROMPT = (
    "Classify the attached campus photo. "
    "Return a JSON object with exactly these keys and no others: "
    "hazard_type, category, severity_score, summary. "
    "hazard_type must be one of spill, blockage, elevator, "
    "entrance, walking_surface, other. "
    "category must be an integer. It names the specific "
    "condition within that hazard type. This prompt is the only "
    "definition of the number: choose any whole number that "
    "identifies the condition, and use the same number when the "
    "condition is the same. The number is not a severity. "
    "severity_score must be an integer from 0 through 100. "
    "It is how much the condition interferes with passage. "
    "0 means a clear path and 100 means fully blocked. "
    "summary must be a short non-empty sentence about the photo."
)


class ClassificationError(Exception):
    """The vision call did not return a Classification."""


def classify(
    image: bytes,
    media_type: str,
    description: str | None = None,
) -> Classification:
    """Classifies one photo with a single vision call.

    Args:
        image: Raw image bytes.
        media_type: image/jpeg, image/png, or image/heic.
        description: What the member wrote about the hazard. The type
            and severity come from this text and the photo together.

    Returns:
        The classification from the model.

    Raises:
        ClassificationError: The media type is unsupported, the vision
            call failed, or the model output was not a classification.
    """
    if media_type not in _ACCEPTED_MEDIA_TYPES:
        raise ClassificationError("Unsupported media type.")
    try:
        content = request_classification(image, media_type, description)
    except ClassificationError:
        raise
    except Exception as error:
        raise ClassificationError("The vision call failed.") from error
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, TypeError) as error:
        raise ClassificationError(
            "The vision call did not return a Classification."
        ) from error
    return parse_classification(payload)


def parse_classification(payload: object) -> Classification:
    """Parses a model object into a classification.

    Args:
        payload: Object with hazard_type, category, severity_score,
            and summary.

    Returns:
        The classification.

    Raises:
        ClassificationError: The object is not a classification.
    """
    if not isinstance(payload, dict) or not _REQUIRED.issubset(payload):
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    hazard_type = _hazard_type(payload["hazard_type"])
    category = _integer(payload["category"])
    severity_score = _integer(payload["severity_score"])
    if severity_score < 0 or severity_score > 100:
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    summary = payload["summary"]
    if not isinstance(summary, str) or summary == "":
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    try:
        return Classification(
            hazard_type=hazard_type,
            category=category,
            severity_score=severity_score,
            summary=summary,
        )
    except ValidationError as error:
        raise ClassificationError(
            "The vision call did not return a Classification."
        ) from error


def request_classification(
    image: bytes,
    media_type: str,
    description: str | None = None,
) -> str:
    """Posts the photo once and returns the assistant message text.

    Args:
        image: Raw image bytes.
        media_type: image/jpeg, image/png, or image/heic.
        description: What the member wrote, included with the photo.

    Returns:
        The assistant message content, which should be a JSON object.

    Raises:
        ClassificationError: Settings are missing, the HTTP call
            failed, or the body had no message text.
    """
    url = _setting("VISION_API_URL")
    api_key = _setting("VISION_API_KEY")
    model = _setting("VISION_MODEL")
    encoded = base64.b64encode(image).decode("ascii")
    data_url = f"data:{media_type};base64,{encoded}"
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _prompt(description)},
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url},
                    },
                ],
            }
        ],
        "response_format": {"type": "json_object"},
    }
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ClassificationError("The vision call failed.") from error
    if not response.content:
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    try:
        envelope = response.json()
    except ValueError as error:
        raise ClassificationError(
            "The vision call did not return a Classification."
        ) from error
    return _message_text(envelope)


def _prompt(description: str | None) -> str:
    """Builds the vision prompt from the photo instructions and the note.

    Args:
        description: What the member wrote, or nothing.

    Returns:
        The prompt. A blank note leaves the photo instructions alone.
    """
    note = "" if description is None else description.strip()
    if note == "":
        return PROMPT
    return (
        f"{PROMPT} The member wrote this description: {note} "
        "Choose hazard_type and severity_score from the photo and "
        "this description together."
    )


def _setting(name: str) -> str:
    """Reads one required vision setting.

    Args:
        name: Environment variable name.

    Returns:
        The stripped value.

    Raises:
        ClassificationError: The variable is missing or blank.
    """
    value = str(getattr(get_settings(), name.lower(), "")).strip()
    if value == "":
        raise ClassificationError("The vision call is not configured.")
    return value


def _hazard_type(value: object) -> HazardType:
    """Reads a hazard type, without coercing an unknown value.

    Args:
        value: The hazard_type field from the model object.

    Returns:
        The matching hazard type.

    Raises:
        ClassificationError: The value is not one of the six types.
    """
    if not isinstance(value, str):
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    try:
        return HazardType(value)
    except ValueError as error:
        raise ClassificationError(
            "The vision call did not return a Classification."
        ) from error


def _integer(value: object) -> int:
    """Reads an integer, without coercing strings or booleans.

    Args:
        value: A numeric field from the model object.

    Returns:
        The integer.

    Raises:
        ClassificationError: The value is not an integer.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    return value


def _message_text(body: object) -> str:
    """Reads choices[0].message.content from a chat completion.

    Args:
        body: Parsed JSON from the vision endpoint.

    Returns:
        The assistant message text.

    Raises:
        ClassificationError: The body has no message text.
    """
    try:
        if not isinstance(body, dict):
            raise TypeError
        choices = body["choices"]
        if not isinstance(choices, list):
            raise TypeError
        message = choices[0]["message"]
        if not isinstance(message, dict):
            raise TypeError
        content = message["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise ClassificationError(
            "The vision call did not return a Classification."
        ) from error
    if not isinstance(content, str) or content == "":
        raise ClassificationError(
            "The vision call did not return a Classification."
        )
    return content
