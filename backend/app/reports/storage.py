"""Object storage for photo reports.

The service role key stays on the server. A photo report stores the
object key, and the phone reads the public URL itself.
"""

from urllib.parse import quote

import httpx

from app.config import Settings, get_settings

_TIMEOUT_SECONDS = 30.0


class StorageError(Exception):
    """Supabase Storage rejected a call or could not be reached.

    Attributes:
        code: Short error code.
    """

    def __init__(self, code: str) -> None:
        """Stores the code.

        Args:
            code: Short error code.
        """
        self.code = code
        super().__init__(code)


def put_object(path: str, body: bytes, content_type: str) -> None:
    """Uploads a photo object.

    Args:
        path: Object key inside the configured bucket.
        body: Raw image bytes.
        content_type: Media type of those bytes.

    Raises:
        StorageError: The upload was rejected or the service was
            unreachable.
    """
    _send("POST", path, content_type, body)


def delete_object(path: str) -> None:
    """Deletes a photo object.

    Args:
        path: Object key inside the configured bucket.

    Raises:
        StorageError: The delete was rejected or the service was
            unreachable.
    """
    _send("DELETE", path, "application/json", None)


def _send(
    method: str,
    path: str,
    content_type: str,
    body: bytes | None,
) -> None:
    """Sends one storage request.

    Args:
        method: HTTP method.
        path: Object key inside the configured bucket.
        content_type: Value of the Content-Type header.
        body: Raw bytes for an upload. None for a delete.

    Raises:
        StorageError: The call failed.
    """
    settings = get_settings()
    try:
        response = httpx.request(
            method,
            _object_url(settings, path),
            headers=_headers(settings, content_type),
            content=body,
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise StorageError("unreachable") from error
    if response.status_code >= 400:
        raise StorageError("rejected")


def _object_url(settings: Settings, path: str) -> str:
    """Builds the storage object URL.

    Args:
        settings: Process settings.
        path: Object key.

    Returns:
        The absolute URL of that object.
    """
    bucket = quote(settings.storage_bucket, safe="")
    key = quote(path, safe="/")
    root = settings.supabase_url.rstrip("/")
    return f"{root}/storage/v1/object/{bucket}/{key}"


def _headers(settings: Settings, content_type: str) -> dict[str, str]:
    """Builds the storage request headers.

    Args:
        settings: Process settings.
        content_type: Value of the Content-Type header.

    Returns:
        Headers carrying the service role key.
    """
    token = settings.supabase_service_role_key
    return {
        "apikey": token,
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
    }
