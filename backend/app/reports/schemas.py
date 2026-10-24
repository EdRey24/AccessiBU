"""Photo and text report bodies.

Classification, TextReportCreate, and the submit models are not tables.
A text submission carries its own severity. A photo submission carries
a place, and the vision call supplies the severity.
"""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.reports.models import HazardType


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

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        """Drops surrounding whitespace.

        Args:
            value: The text the member wrote.

        Returns:
            The stripped description.

        Raises:
            ValueError: The description is empty.
        """
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A description is required.")
        return cleaned


class ReportPlace(BaseModel):
    """Where a submission is stored. Not a table.

    Attributes:
        latitude: North-south coordinate of a new hazard.
        longitude: East-west coordinate of a new hazard.
        hazard_id: An open hazard to attach to. Omit to open one.
    """

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    hazard_id: UUID | None = None

    @model_validator(mode="after")
    def _place(self) -> Self:
        """Requires a place when the submission opens a hazard.

        Returns:
            This place.

        Raises:
            ValueError: A new hazard has no coordinates.
        """
        if self.hazard_id is None and (
            self.latitude is None or self.longitude is None
        ):
            raise ValueError(
                "A new hazard needs a latitude and a longitude.",
            )
        return self


class TextReportSubmit(TextReportCreate, ReportPlace):
    """A text submission and where it belongs. Not a table."""


Report = Annotated[PhotoReport | TextReport, Field(discriminator="kind")]
