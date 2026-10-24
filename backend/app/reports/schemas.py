"""Photo and text report bodies.

Classification and TextReportCreate are not tables. A later submit
route copies TextReportCreate.severity_score onto the hazard. A photo
score will come from Classification.severity_score the same way.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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


Report = Annotated[PhotoReport | TextReport, Field(discriminator="kind")]
