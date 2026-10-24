"""Request and response bodies for members and sessions."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.members.models import MemberRole


def _normalize_email(value: object) -> object:
    """Lowercases an address so the domain check ignores case.

    Args:
        value: The submitted address, or a non-string rejected later.

    Returns:
        The stripped, lowercased address when the value is a string.
        Otherwise the original value, so type validation can reject it.
    """
    if isinstance(value, str):
        return value.strip().lower()
    return value


class MemberCreate(BaseModel):
    """Email and password submitted to register or log in.

    Attributes:
        email: Sign-in address. It must end in @bu.edu.
        password: Plaintext password of at least 8 characters. It is
            forwarded to Supabase Auth and is never stored here.
    """

    email: str = Field(pattern=r"^[^@\s]+@bu\.edu$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        """Normalizes the submitted email address.

        Args:
            value: The address as submitted.

        Returns:
            The address passed to the domain pattern.
        """
        return _normalize_email(value)


class Member(BaseModel):
    """A signed-in member.

    Attributes:
        id: Primary key, equal to the auth user id.
        email: The member's @bu.edu address.
        role: member or admin. New accounts are member.
        mobility_preference: Whether the person needs a barrier-free
            path. Unused until routing exists.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: MemberRole
    mobility_preference: bool = False


class MemberSession(BaseModel):
    """Supabase tokens plus the member they name.

    Attributes:
        access_token: Bearer token for later API calls.
        refresh_token: Token exchanged for a new access token.
        member: The member the session belongs to.
    """

    access_token: str
    refresh_token: str
    member: Member


class RefreshRequest(BaseModel):
    """A refresh token presented for a new session.

    Attributes:
        refresh_token: The refresh token from an earlier session.
    """

    refresh_token: str = Field(min_length=1)


class ForgotPassword(BaseModel):
    """An address that may receive a reset mail.

    Attributes:
        email: The address the caller claims. Any value gets the same
            acknowledgement.
    """

    email: str = Field(min_length=1, max_length=255)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        """Normalizes the submitted email address.

        Args:
            value: The address as submitted.

        Returns:
            The address, lowercased when it is a string.
        """
        return _normalize_email(value)


class ResetPassword(BaseModel):
    """A reset token and the password that replaces the old one.

    Attributes:
        token: The access token Supabase put on the reset link.
        password: The new password, at least 8 characters.
    """

    token: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=128)


class Acknowledgement(BaseModel):
    """A reply that does not say whether an address is registered.

    Attributes:
        detail: The fixed sentence returned for every request.
    """

    detail: str
