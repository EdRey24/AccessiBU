"""Request dependencies for a signed-in member."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.members import supabase
from app.members.models import Member, MemberRole
from app.members.supabase import InvalidAccessToken

bearer = HTTPBearer()
_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def current_member(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> Member:
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
    member = db.get(Member, member_id)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers=_UNAUTHORIZED,
        )
    return member


def current_admin(member: Member = Depends(current_member)) -> Member:
    """Loads the signed-in member and requires the admin role.

    Args:
        member: The member named by the bearer access token.

    Returns:
        The same member, once confirmed as an admin.

    Raises:
        HTTPException: The member is not an admin.
    """
    if member.role is not MemberRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Facilities access is required.",
        )
    return member
