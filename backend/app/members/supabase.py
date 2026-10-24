"""HTTP calls to Supabase Auth.

The anon key stays on the server. Passwords are forwarded and not
stored.
"""

import uuid
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt

from app.config import get_settings

_TIMEOUT_SECONDS = 10.0


class SupabaseAuthError(Exception):
    """Supabase Auth rejected a call.

    Attributes:
        status_code: HTTP status returned by Supabase, or 502 when the
            body was not a session.
        code: Machine-readable error code, when one was available.
    """

    def __init__(self, status_code: int, code: str) -> None:
        """Stores the status and code.

        Args:
            status_code: HTTP status to remember.
            code: Short error code.
        """
        self.status_code = status_code
        self.code = code
        super().__init__(code)


class InvalidAccessToken(Exception):
    """The bearer token is not a Supabase access token."""


@dataclass(frozen=True)
class AuthSession:
    """Tokens issued by Supabase Auth.

    Attributes:
        access_token: Bearer token for later API calls.
        refresh_token: Token used to mint a new access token.
        user_id: Auth user id, which is also the member id.
    """

    access_token: str
    refresh_token: str
    user_id: uuid.UUID


def sign_up(email: str, password: str) -> AuthSession:
    """Creates an auth user and returns its session.

    Args:
        email: Address ending in @bu.edu.
        password: Plaintext password forwarded to Supabase.

    Returns:
        The new session.

    Raises:
        SupabaseAuthError: Supabase rejected the signup or returned no
            session.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = _post("/auth/v1/signup", {"email": email, "password": password})
    _raise_for_status(response)
    return _session_from_body(response.json())


def sign_in(email: str, password: str) -> AuthSession:
    """Exchanges an email and password for a session.

    Args:
        email: Address ending in @bu.edu.
        password: Plaintext password forwarded to Supabase.

    Returns:
        The session Supabase issued.

    Raises:
        SupabaseAuthError: The credentials were rejected or the body
            had no session.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = _post(
        "/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
    )
    _raise_for_status(response)
    return _session_from_body(response.json())


def refresh(refresh_token: str) -> AuthSession:
    """Exchanges a refresh token for a new session.

    Args:
        refresh_token: The refresh token from an earlier session.

    Returns:
        The replacement session.

    Raises:
        SupabaseAuthError: The refresh token was rejected.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = _post(
        "/auth/v1/token?grant_type=refresh_token",
        {"refresh_token": refresh_token},
    )
    _raise_for_status(response)
    return _session_from_body(response.json())


def logout(access_token: str) -> None:
    """Revokes the session that owns this access token.

    Args:
        access_token: Bearer token of the session to revoke.

    Raises:
        SupabaseAuthError: Supabase refused the revocation.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = httpx.post(
        _url("/auth/v1/logout?scope=local"),
        headers=_headers(access_token),
        timeout=_TIMEOUT_SECONDS,
    )
    _raise_for_status(response)


def send_reset_mail(email: str) -> None:
    """Asks Supabase to mail a password reset link.

    Args:
        email: Address that may belong to a member.

    Raises:
        SupabaseAuthError: Supabase refused the request.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = _post("/auth/v1/recover", {"email": email})
    _raise_for_status(response)


def reset_password(token: str, password: str) -> None:
    """Sets a new password with the token from a reset link.

    Args:
        token: Access token Supabase attached to the reset link.
        password: The replacement password.

    Raises:
        SupabaseAuthError: The token was rejected.
        httpx.HTTPError: The Auth service could not be reached.
    """
    response = httpx.put(
        _url("/auth/v1/user"),
        headers=_headers(token),
        json={"password": password},
        timeout=_TIMEOUT_SECONDS,
    )
    _raise_for_status(response)


def member_id_from_access_token(token: str) -> uuid.UUID:
    """Reads the member id from a Supabase access token.

    The token must be signed by a key published at the project's JWKS
    endpoint. Shared-secret (HS256) tokens are rejected.

    Args:
        token: Bearer token from the Authorization header.

    Returns:
        The auth user id stored in the token subject.

    Raises:
        InvalidAccessToken: The token is expired, unsigned, signed by
            an unknown key, or has no subject.
    """
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
        return uuid.UUID(str(payload["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError) as error:
        raise InvalidAccessToken from error


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    """Returns the cached JWKS client for this process.

    Returns:
        A client that fetches and caches the project's signing keys.
    """
    settings = get_settings()
    url = (
        f"{settings.supabase_url.rstrip('/')}"
        "/auth/v1/.well-known/jwks.json"
    )
    return jwt.PyJWKClient(
        url,
        headers={"apikey": settings.supabase_anon_key},
    )


def _url(path: str) -> str:
    """Joins a path onto the Supabase project URL.

    Args:
        path: Absolute path beginning with a slash.

    Returns:
        The full Auth URL.
    """
    return f"{get_settings().supabase_url.rstrip('/')}{path}"


def _headers(token: str | None = None) -> dict[str, str]:
    """Builds the Auth request headers.

    Args:
        token: Bearer token, when the call acts as a signed-in user.

    Returns:
        Headers carrying the anon key and, when given, the bearer token.
    """
    headers = {
        "apikey": get_settings().supabase_anon_key,
        "Content-Type": "application/json",
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _post(path: str, body: dict[str, str]) -> httpx.Response:
    """Posts JSON to Supabase Auth.

    Args:
        path: Absolute path beginning with a slash.
        body: JSON object. It may contain a password.

    Returns:
        The raw response. The caller checks the status.
    """
    return httpx.post(
        _url(path),
        headers=_headers(),
        json=body,
        timeout=_TIMEOUT_SECONDS,
    )


def _raise_for_status(response: httpx.Response) -> None:
    """Raises when Supabase returns an error status.

    Args:
        response: The Auth response.

    Raises:
        SupabaseAuthError: The status is 400 or higher.
    """
    if response.status_code < 400:
        return
    code = ""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        raw = (
            payload.get("error_code")
            or payload.get("error")
            or payload.get("msg")
            or payload.get("error_description")
            or ""
        )
        code = str(raw)
    raise SupabaseAuthError(response.status_code, code)


def _session_from_body(body: object) -> AuthSession:
    """Reads tokens and the user id from an Auth response.

    Args:
        body: Parsed JSON. A session may sit at the top level or under
            a session key.

    Returns:
        The session fields the API returns to the app.

    Raises:
        SupabaseAuthError: The body has no tokens or no user id.
    """
    if not isinstance(body, dict):
        raise SupabaseAuthError(502, "missing_session")
    nested = body.get("session")
    source = nested if isinstance(nested, dict) else body
    access = source.get("access_token")
    refresh = source.get("refresh_token")
    user = body.get("user")
    if not isinstance(user, dict):
        user = source.get("user")
    user_id = user.get("id") if isinstance(user, dict) else None
    if not isinstance(access, str) or not isinstance(refresh, str):
        raise SupabaseAuthError(502, "missing_session")
    if not isinstance(user_id, str):
        raise SupabaseAuthError(502, "missing_user")
    try:
        parsed_id = uuid.UUID(user_id)
    except ValueError as error:
        raise SupabaseAuthError(502, "missing_user") from error
    return AuthSession(
        access_token=access,
        refresh_token=refresh,
        user_id=parsed_id,
    )
