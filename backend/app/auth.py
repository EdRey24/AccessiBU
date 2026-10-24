"""Member registration and bearer-token login.

Register accepts only an @bu.edu address and always stores the member
role. Login checks the password hash and returns a signed bearer token.
Unknown addresses and wrong passwords share one error so a caller cannot
tell which of the two failed.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Member as MemberRow
from app.models import MemberRole
from app.schemas import Member, MemberCreate, Token

router = APIRouter(prefix="/auth", tags=["auth"])
_password_hash = PasswordHash.recommended()
_bearer = HTTPBearer()


def _encode_token(member_id: uuid.UUID) -> str:
    """Signs a bearer token for a member.

    Args:
        member_id: The member the token represents.

    Returns:
        A JWT whose subject is the member id.
    """
    settings = get_settings()
    expires = datetime.now(UTC) + timedelta(seconds=settings.jwt_ttl_seconds)
    payload = {"sub": str(member_id), "exp": expires}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    if isinstance(token, bytes):
        return token.decode("ascii")
    return token


def _member_from_token(token: str, db: Session) -> MemberRow:
    """Loads the member named by a bearer token.

    Args:
        token: The JWT from the Authorization header.
        db: Open database session.

    Returns:
        The member whose id is the token subject.

    Raises:
        HTTPException: The token is missing, expired, or names no member.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
        )
        member_id = uuid.UUID(str(payload["sub"]))
    except (jwt.PyJWTError, ValueError, KeyError) as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    member = db.get(MemberRow, member_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return member


@router.post("/register", response_model=Member, status_code=201)
def register(
    body: MemberCreate,
    db: Session = Depends(get_db),
) -> MemberRow:
    """Registers a member.

    Args:
        body: Email and password for the new member.
        db: Open database session.

    Returns:
        The stored member, without the password hash.

    Raises:
        HTTPException: The email is already registered.
    """
    existing = db.scalar(select(MemberRow).where(MemberRow.email == body.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered.",
        )
    member = MemberRow(
        email=body.email,
        password_hash=_password_hash.hash(body.password),
        role=MemberRole.MEMBER,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.post("/login", response_model=Token)
def login(
    body: MemberCreate,
    db: Session = Depends(get_db),
) -> Token:
    """Logs a member in.

    Args:
        body: Email and password to check.
        db: Open database session.

    Returns:
        A bearer token for the member.

    Raises:
        HTTPException: The email or password does not match a member.
    """
    member = db.scalar(select(MemberRow).where(MemberRow.email == body.email))
    password_matches = member is not None and _password_hash.verify(
        body.password,
        member.password_hash,
    )
    if member is None or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(access_token=_encode_token(member.id))


@router.get("/me", response_model=Member)
def current_member(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> MemberRow:
    """Returns the member named by the bearer token.

    Args:
        credentials: Authorization header carrying the bearer token.
        db: Open database session.

    Returns:
        The signed-in member, without the password hash.
    """
    return _member_from_token(credentials.credentials, db)
