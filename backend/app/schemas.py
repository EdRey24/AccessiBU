"""Pydantic request and response bodies.

Classification and TextReportCreate are not tables. A later submit
route copies TextReportCreate.severity_score onto the hazard. A photo
score will come from Classification.severity_score the same way.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import HazardStatus, HazardType, MemberRole


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
            hashed before storage and is never returned.
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
    """A signed-in member, without the password hash.

    Attributes:
        id: Primary key.
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


class Token(BaseModel):
    """A bearer token issued at login.

    Attributes:
        access_token: The signed JWT.
        token_type: Always "bearer".
    """

    access_token: str
    token_type: str = "bearer"


class Hazard(BaseModel):
    """A hazard returned by a later read route.

    Attributes:
        id: Primary key.
        latitude: North-south coordinate.
        longitude: East-west coordinate.
        status: open or resolved.
        created_at: When the hazard was stored.
        severity_score: Passage interference from 0 through 100.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: HazardStatus
    created_at: datetime
    severity_score: int = Field(ge=0, le=100)


class Classification(BaseModel):
    """The return value of the one vision call. Not a table.

    Attributes:
        hazard_type: Kind of condition, written onto the photo report.
        category: Numeric code, written onto the photo report.
        severity_score: Passage interference, written onto the hazard.
        summary: Short account of the photo, written onto the report.
    """

    hazard_type: HazardType
    category: int
    severity_score: int = Field(ge=0, le=100)
    summary: str = Field(min_length=1)


class PhotoReport(BaseModel):
    """A finished photo report.

    Attributes:
        kind: Always photo.
        id: Primary key.
        hazard_id: The hazard this photo describes.
        member_id: The member who submitted it.
        image_path: Storage key of the captured image.
        created_at: When the report was stored.
        hazard_type: Kind of condition.
        category: Numeric code alongside the hazard type.
        summary: Short account of what the photo shows.
    """

    model_config = ConfigDict(from_attributes=True)

    kind: Literal["photo"] = "photo"
    id: UUID
    hazard_id: UUID
    member_id: UUID
    image_path: str = Field(min_length=1)
    created_at: datetime
    hazard_type: HazardType
    category: int
    summary: str = Field(min_length=1)


class TextReport(BaseModel):
    """A stored text report. The severity score lives on the hazard.

    Attributes:
        kind: Always text.
        id: Primary key.
        hazard_id: The hazard this text describes.
        member_id: The member who submitted it.
        created_at: When the report was stored.
        hazard_type: Kind of condition.
        category: Numeric code alongside the hazard type.
        description: Text the member wrote.
    """

    model_config = ConfigDict(from_attributes=True)

    kind: Literal["text"] = "text"
    id: UUID
    hazard_id: UUID
    member_id: UUID
    created_at: datetime
    hazard_type: HazardType
    category: int
    description: str = Field(min_length=1)


class TextReportCreate(BaseModel):
    """A text submission. Not a table.

    Attributes:
        hazard_type: Kind of condition.
        category: Numeric code alongside the hazard type.
        description: Text the member wrote.
        severity_score: Passage interference copied onto the hazard.
            The text report row does not keep a copy.
    """

    hazard_type: HazardType
    category: int
    description: str = Field(min_length=1)
    severity_score: int = Field(ge=0, le=100)


Report = Annotated[PhotoReport | TextReport, Field(discriminator="kind")]


class Alert(BaseModel):
    """The single facilities notice for one hazard.

    Attributes:
        id: Primary key.
        hazard_id: The hazard this notice is about.
        sent_at: When the email was sent, or null if it has not been.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    hazard_id: UUID
    sent_at: datetime | None = None
