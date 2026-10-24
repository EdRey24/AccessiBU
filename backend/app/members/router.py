"""Session routes backed by Supabase Auth.

Register and login forward the password and return Supabase tokens with
the member row. This service does not hash passwords or sign tokens.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.members import supabase
from app.members.models import Member as MemberRow
from app.members.schemas import (
    Acknowledgement,
    ForgotPassword,
    Member,
    MemberCreate,
    MemberSession,
    RefreshRequest,
    ResetPassword,
)
from app.members.supabase import (
    AuthSession,
    InvalidAccessToken,
    SupabaseAuthError,
)

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer()
_RESET_ACK = "If that address is registered, a reset mail is on its way."
_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def _member_session(auth: AuthSession, db: Session) -> MemberSession:
    """Loads the member for a Supabase session.

    Args:
        auth: Tokens and user id from Supabase.
        db: Open database session.

    Returns:
        The tokens plus the member row.

    Raises:
        HTTPException: The auth user has no member row.
    """
    member = db.get(MemberRow, auth.user_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Member was not created.",
        )
    return MemberSession(
        access_token=auth.access_token,
        refresh_token=auth.refresh_token,
        member=Member.model_validate(member),
    )


def _member_from_bearer(
    credentials: HTTPAuthorizationCredentials,
    db: Session,
) -> MemberRow:
    """Loads the member named by a bearer access token.

    Args:
        credentials: Authorization header carrying the access token.
        db: Open database session.

    Returns:
        The member whose id is the token subject.

    Raises:
        HTTPException: The token is invalid or names no member.
    """
    try:
        member_id = supabase.member_id_from_access_token(
            credentials.credentials,
        )
    except InvalidAccessToken as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers=_UNAUTHORIZED,
        ) from error
    member = db.get(MemberRow, member_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers=_UNAUTHORIZED,
        )
    return member


def _unavailable(error: httpx.HTTPError) -> HTTPException:
    """Maps a transport failure to a gateway error.

    Args:
        error: The error raised by the HTTP client.

    Returns:
        A 502 the route can raise.
    """
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Auth service is unavailable.",
    )


def _duplicate(error: SupabaseAuthError) -> bool:
    """Reports whether Supabase already has this address.

    Args:
        error: The Auth error to inspect.

    Returns:
        True when the address is already registered.
    """
    code = error.code.lower()
    return "already" in code or code in {"user_already_exists", "email_exists"}


@router.post("/register", response_model=MemberSession, status_code=201)
def register(
    body: MemberCreate,
    db: Session = Depends(get_db),
) -> MemberSession:
    """Registers a member and returns a session.

    Args:
        body: Email and password for the new member.
        db: Open database session.

    Returns:
        Supabase tokens and the member the insert trigger created.

    Raises:
        HTTPException: The address is already registered, Supabase
            returned no session, or the Auth service is unavailable.
    """
    try:
        auth = supabase.sign_up(body.email, body.password)
    except SupabaseAuthError as error:
        if _duplicate(error):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already registered.",
            ) from error
        if error.code == "missing_session":
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Auth service did not return a session.",
            ) from error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth service is unavailable.",
        ) from error
    except httpx.HTTPError as error:
        raise _unavailable(error) from error
    return _member_session(auth, db)


@router.post("/login", response_model=MemberSession)
def login(body: MemberCreate, db: Session = Depends(get_db)) -> MemberSession:
    """Logs a member in.

    Args:
        body: Email and password to check.
        db: Open database session.

    Returns:
        Supabase tokens and the member.

    Raises:
        HTTPException: The email or password does not match, or the
            Auth service is unavailable.
    """
    try:
        auth = supabase.sign_in(body.email, body.password)
    except SupabaseAuthError as error:
        if error.status_code < 500:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
                headers=_UNAUTHORIZED,
            ) from error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth service is unavailable.",
        ) from error
    except httpx.HTTPError as error:
        raise _unavailable(error) from error
    return _member_session(auth, db)


@router.post("/refresh", response_model=MemberSession)
def refresh_session(
    body: RefreshRequest,
    db: Session = Depends(get_db),
) -> MemberSession:
    """Exchanges a refresh token for a new session.

    Args:
        body: The refresh token to exchange.
        db: Open database session.

    Returns:
        The replacement tokens and the member.

    Raises:
        HTTPException: The refresh token is invalid or the Auth service
            is unavailable.
    """
    try:
        auth = supabase.refresh(body.refresh_token)
    except SupabaseAuthError as error:
        if error.status_code < 500:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token.",
                headers=_UNAUTHORIZED,
            ) from error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth service is unavailable.",
        ) from error
    except httpx.HTTPError as error:
        raise _unavailable(error) from error
    return _member_session(auth, db)


@router.get("/me", response_model=Member)
def current_member(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> MemberRow:
    """Returns the member named by the bearer token.

    Args:
        credentials: Authorization header carrying the access token.
        db: Open database session.

    Returns:
        The signed-in member.
    """
    return _member_from_bearer(credentials, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> None:
    """Revokes this session.

    Args:
        credentials: Authorization header carrying the access token.
        db: Open database session.

    Raises:
        HTTPException: The token is invalid or the Auth service is
            unavailable.
    """
    _member_from_bearer(credentials, db)
    try:
        supabase.logout(credentials.credentials)
    except SupabaseAuthError as error:
        if error.status_code in {400, 401, 403}:
            return
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth service is unavailable.",
        ) from error
    except httpx.HTTPError as error:
        raise _unavailable(error) from error


@router.post("/forgot-password", response_model=Acknowledgement)
def forgot_password(body: ForgotPassword) -> Acknowledgement:
    """Sends a reset mail when the address can belong to a member.

    Args:
        body: The address to mail. The reply does not say whether it
            is registered.

    Returns:
        The same acknowledgement for every address.
    """
    if body.email.endswith("@bu.edu"):
        try:
            supabase.send_reset_mail(body.email)
        except (SupabaseAuthError, httpx.HTTPError):
            pass
    return Acknowledgement(detail=_RESET_ACK)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPassword) -> None:
    """Sets a new password and does not open a session.

    Args:
        body: The reset token and the replacement password.

    Raises:
        HTTPException: The token is invalid or the Auth service is
            unavailable.
    """
    try:
        supabase.reset_password(body.token, body.password)
    except SupabaseAuthError as error:
        if error.status_code in {400, 401, 403, 422}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset token.",
            ) from error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth service is unavailable.",
        ) from error
    except httpx.HTTPError as error:
        raise _unavailable(error) from error
