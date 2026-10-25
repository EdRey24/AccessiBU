"""Tests for the one vision classification call."""

import base64
import json
import os
import unittest
from unittest import mock

import httpx

from app.reports.classify import (
    PROMPT,
    ClassificationError,
    NotAHazard,
    classify,
    parse_classification,
    request_classification,
)
from app.reports.models import HazardType
from app.reports.schemas import Classification

_VALID = {
    "is_hazard": True,
    "hazard_type": "blockage",
    "category": 4,
    "severity_score": 10,
    "summary": "A door is blocked.",
}


class ParseClassificationTests(unittest.TestCase):
    """Checks that model objects become a Classification or an error."""

    def test_accepts_valid_object(self) -> None:
        """A complete object becomes a Classification."""
        result = parse_classification(_VALID)
        self.assertIsInstance(result, Classification)
        self.assertEqual(result.hazard_type, HazardType.BLOCKAGE)
        self.assertEqual(result.category, 4)
        self.assertEqual(result.severity_score, 10)
        self.assertEqual(result.summary, "A door is blocked.")

        odd = dict(_VALID)
        odd["category"] = -3
        parsed = parse_classification(odd)
        self.assertEqual(parsed.category, -3)

    def test_refuses_when_the_photo_is_not_a_hazard(self) -> None:
        """is_hazard false is a refusal, with or without other fields."""
        with self.assertRaises(NotAHazard):
            parse_classification({"is_hazard": False})
        payload = dict(_VALID)
        payload["is_hazard"] = False
        with self.assertRaises(NotAHazard):
            parse_classification(payload)

    def test_rejects_a_missing_or_non_boolean_flag(self) -> None:
        """A classification needs a boolean is_hazard flag."""
        missing = dict(_VALID)
        del missing["is_hazard"]
        with self.assertRaises(ClassificationError):
            parse_classification(missing)
        for flag in ("false", 0, None):
            with self.subTest(flag=flag):
                payload = dict(_VALID)
                payload["is_hazard"] = flag
                with self.assertRaises(ClassificationError):
                    parse_classification(payload)

    def test_rejects_unknown_hazard_type(self) -> None:
        """An unknown hazard type is a classification error."""
        payload = dict(_VALID)
        payload["hazard_type"] = "flood"
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_score_of_11(self) -> None:
        """A severity score of 11 is a classification error."""
        payload = dict(_VALID)
        payload["severity_score"] = 11
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_score_of_zero(self) -> None:
        """A clear-path score of 0 is not a classification."""
        payload = dict(_VALID)
        payload["severity_score"] = 0
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_score_of_negative_one(self) -> None:
        """A severity score of -1 is a classification error."""
        payload = dict(_VALID)
        payload["severity_score"] = -1
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_empty_summary(self) -> None:
        """An empty summary is a classification error."""
        payload = dict(_VALID)
        payload["summary"] = ""
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_missing_field(self) -> None:
        """A missing field is a classification error."""
        payload = dict(_VALID)
        del payload["summary"]
        with self.assertRaises(ClassificationError):
            parse_classification(payload)

    def test_rejects_non_object(self) -> None:
        """A non-object payload is a classification error."""
        for payload in (None, [], "blockage", 4):
            with self.subTest(payload=payload):
                with self.assertRaises(ClassificationError):
                    parse_classification(payload)

    def test_rejects_non_integer_category(self) -> None:
        """A non-integer category is a classification error."""
        for category in ("4", 4.0, True):
            with self.subTest(category=category):
                payload = dict(_VALID)
                payload["category"] = category
                with self.assertRaises(ClassificationError):
                    parse_classification(payload)


class ClassifyTests(unittest.TestCase):
    """Checks classify against a stand-in for the vision endpoint."""

    def test_rejects_gif_without_calling_the_network(self) -> None:
        """image/gif fails before any vision request."""
        with mock.patch(
            "app.reports.classify.request_classification",
        ) as request:
            with mock.patch("app.reports.classify.httpx.post") as post:
                with self.assertRaises(ClassificationError):
                    classify(b"GIF89a", "image/gif")
                request.assert_not_called()
                post.assert_not_called()

    def test_returns_parsed_classification(self) -> None:
        """A JSON string from the request becomes a Classification."""
        content = json.dumps(_VALID)

        def fake_request(
            image: bytes,
            media_type: str,
            description: str | None = None,
        ) -> str:
            self.assertEqual(image, b"photo")
            self.assertIn(
                media_type,
                ("image/jpeg", "image/png", "image/heic"),
            )
            return content

        for media_type in ("image/jpeg", "image/png", "image/heic"):
            with self.subTest(media_type=media_type):
                with mock.patch(
                    "app.reports.classify.request_classification",
                    wraps=fake_request,
                ) as request:
                    result = classify(b"photo", media_type)
                request.assert_called_once()
                self.assertEqual(result.hazard_type, HazardType.BLOCKAGE)
                self.assertEqual(result.category, 4)
                self.assertEqual(result.severity_score, 10)
                self.assertEqual(result.summary, "A door is blocked.")

    def test_request_raises_classification_error(self) -> None:
        """A failed request becomes a classification error."""
        def fake_request(
            image: bytes,
            media_type: str,
            description: str | None = None,
        ) -> str:
            raise RuntimeError("timed out")

        with mock.patch(
            "app.reports.classify.request_classification",
            fake_request,
        ):
            with self.assertRaises(ClassificationError):
                classify(b"photo", "image/jpeg")

    def test_refusal_is_not_a_classification_error(self) -> None:
        """A refusal stays a NotAHazard instead of a failed call."""

        def fake_request(
            image: bytes,
            media_type: str,
            description: str | None = None,
        ) -> str:
            return json.dumps({"is_hazard": False})

        with mock.patch(
            "app.reports.classify.request_classification",
            fake_request,
        ):
            with self.assertRaises(NotAHazard):
                classify(b"photo", "image/jpeg", "this dude")

    def test_request_returns_non_json(self) -> None:
        """Non-JSON request text is a classification error."""
        def fake_request(
            image: bytes,
            media_type: str,
            description: str | None = None,
        ) -> str:
            return "not json"

        with mock.patch(
            "app.reports.classify.request_classification",
            fake_request,
        ):
            with self.assertRaises(ClassificationError):
                classify(b"photo", "image/png")

    def test_posts_one_chat_completion(self) -> None:
        """One photo is posted once as a chat completion."""
        image = b"\xff\xd8\xff"
        captured: dict[str, object] = {}

        def fake_post(url: str, **kwargs: object) -> "_Response":
            captured["url"] = url
            captured["kwargs"] = kwargs
            return _Response(
                {
                    "choices": [
                        {"message": {"content": json.dumps(_VALID)}}
                    ]
                }
            )

        env = {
            "VISION_API_URL": "https://vision.example/v1/chat/completions",
            "VISION_API_KEY": "secret-key",
            "VISION_MODEL": "vision-model",
        }
        with mock.patch.dict(os.environ, env):
            with mock.patch(
                "app.reports.classify.httpx.post",
                side_effect=fake_post,
            ) as post:
                result = classify(image, "image/jpeg")
        post.assert_called_once()
        self.assertEqual(result.hazard_type, HazardType.BLOCKAGE)
        self.assertEqual(
            captured["url"],
            "https://vision.example/v1/chat/completions",
        )
        kwargs = captured["kwargs"]
        self.assertIsInstance(kwargs, dict)
        self.assertEqual(
            kwargs["headers"],
            {"Authorization": "Bearer secret-key"},
        )
        self.assertEqual(kwargs["timeout"], 30.0)
        body = kwargs["json"]
        self.assertIsInstance(body, dict)
        self.assertEqual(body["model"], "vision-model")
        self.assertEqual(
            body["response_format"],
            {"type": "json_object"},
        )
        content = body["messages"][0]["content"]
        self.assertEqual(content[0], {"type": "text", "text": PROMPT})
        encoded = base64.b64encode(image).decode("ascii")
        self.assertEqual(
            content[1],
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{encoded}",
                },
            },
        )

    def test_prompt_includes_the_member_description(self) -> None:
        """Hazard type and severity are asked to use the written note."""
        captured: dict[str, object] = {}

        def fake_post(url: str, **kwargs: object) -> "_Response":
            captured["kwargs"] = kwargs
            return _Response(
                {
                    "choices": [
                        {"message": {"content": json.dumps(_VALID)}}
                    ]
                }
            )

        env = {
            "VISION_API_URL": "https://vision.example/v1/chat/completions",
            "VISION_API_KEY": "secret-key",
            "VISION_MODEL": "vision-model",
        }
        with mock.patch.dict(os.environ, env):
            with mock.patch(
                "app.reports.classify.httpx.post",
                side_effect=fake_post,
            ):
                classify(b"\xff\xd8\xff", "image/jpeg", "Cart in the doorway")
        kwargs = captured["kwargs"]
        self.assertIsInstance(kwargs, dict)
        body = kwargs["json"]
        self.assertIsInstance(body, dict)
        content = body["messages"][0]["content"]
        text = content[0]["text"]
        self.assertIn("Cart in the doorway", text)
        self.assertIn("follow the photo", text)
        self.assertIn("may sharpen", text)

    def test_http_failure_and_empty_body(self) -> None:
        """A timeout or an empty body is a classification error."""
        env = {
            "VISION_API_URL": "https://vision.example/v1/chat/completions",
            "VISION_API_KEY": "secret-key",
            "VISION_MODEL": "vision-model",
        }

        def timeout(url: str, **kwargs: object) -> object:
            raise httpx.TimeoutException("timed out")

        with mock.patch.dict(os.environ, env):
            with mock.patch(
                "app.reports.classify.httpx.post",
                side_effect=timeout,
            ):
                with self.assertRaises(ClassificationError):
                    request_classification(b"photo", "image/jpeg")

            with mock.patch(
                "app.reports.classify.httpx.post",
                return_value=_Response(b""),
            ):
                with self.assertRaises(ClassificationError):
                    request_classification(b"photo", "image/jpeg")

    def test_missing_settings_do_not_call_the_network(self) -> None:
        """Missing vision settings fail before any HTTP call."""
        cases = (
            {},
            {
                "VISION_API_URL": "https://vision.example",
                "VISION_API_KEY": "secret-key",
            },
            {
                "VISION_API_URL": "  ",
                "VISION_API_KEY": "secret-key",
                "VISION_MODEL": "vision-model",
            },
        )
        for env in cases:
            with self.subTest(env=sorted(env)):
                with mock.patch.dict(os.environ, env, clear=True):
                    with mock.patch(
                        "app.reports.classify.httpx.post",
                    ) as post:
                        with self.assertRaises(ClassificationError):
                            classify(b"photo", "image/jpeg")
                        post.assert_not_called()


class _Response:
    """Stand-in for the httpx response the adapter reads."""

    def __init__(self, body: dict[str, object] | bytes) -> None:
        if isinstance(body, bytes):
            self.content = body
            self._payload: object = None
        else:
            self.content = json.dumps(body).encode("utf-8")
            self._payload = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        if self.content == b"":
            raise ValueError("empty")
        return self._payload


if __name__ == "__main__":
    unittest.main()
