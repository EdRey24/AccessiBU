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

from app.hazards.models import HazardStatus
from app.hazards.schemas import PlanPosition
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
        floor: Floor value the pin sits on. Omit for an outside hazard.
        position_x: Normalized pin x (0..1) on the floor plan.
        position_y: Normalized pin y (0..1) on the floor plan.
        hazard_id: An open hazard to attach to. Omit to open one.
    """

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    floor: int | None = None
    position_x: float | None = Field(default=None, ge=0, le=1)
    position_y: float | None = Field(default=None, ge=0, le=1)
    hazard_id: UUID | None = None

    @field_validator("position_y")
    @classmethod
    def _position_pair(cls, value: float | None, info) -> float | None:
        """Requires x and y together: a point has both or neither.

        Args:
            value: The pin's y coordinate.
            info: Validation context carrying the already-parsed fields.

        Returns:
            The y coordinate.

        Raises:
            ValueError: Only one of x / y was given.
        """
        x = info.data.get("position_x")
        if (x is None) != (value is None):
            raise ValueError("position_x and position_y must be set together.")
        return value

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


class ReportLocation(BaseModel):
    """A new place for the hazard a report describes. Not a table.

    Attributes:
        latitude: North-south coordinate.
        longitude: East-west coordinate.
        floor: Floor the pin sits on, or None for an outside hazard.
        position_x: Normalized pin x (0..1) on the floor plan.
        position_y: Normalized pin y (0..1) on the floor plan.
    """

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    floor: int | None = None
    position_x: float | None = Field(default=None, ge=0, le=1)
    position_y: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def _pair(self) -> Self:
        """Requires x and y together: a point has both or neither.

        Returns:
            This location.

        Raises:
            ValueError: Only one of x / y was given.
        """
        if (self.position_x is None) != (self.position_y is None):
            raise ValueError("position_x and position_y must be set together.")
        return self


class ReportEdit(BaseModel):
    """The fields a member may change on their own report. Not a table.

    Anything not listed here is rejected, so a request cannot touch the
    report owner, the hazard status, or any other column.

    Attributes:
        description: New text. A photo report keeps it as its summary.
        hazard_type: New kind of condition.
        location: New place for the hazard. Allowed only when this is the
            only report on the hazard.
    """

    model_config = ConfigDict(extra="forbid")

    description: str | None = Field(default=None, max_length=1000)
    hazard_type: HazardType | None = None
    location: ReportLocation | None = None

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str | None:
        """Drops surrounding whitespace.

        Args:
            value: The text the member wrote, or nothing.

        Returns:
            The stripped description, or None.

        Raises:
            ValueError: The description is blank.
        """
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A description is required.")
        return cleaned

    @model_validator(mode="after")
    def _something_changes(self) -> Self:
        """Requires at least one field.

        Returns:
            This edit.

        Raises:
            ValueError: The edit changes nothing.
        """
        if (
            self.description is None
            and self.hazard_type is None
            and self.location is None
        ):
            raise ValueError("Nothing to change.")
        return self


class OwnReport(BaseModel):
    """A member's own report with the hazard facts they may edit.

    Attributes:
        id: The report id.
        kind: photo or text.
        hazard_id: The hazard this report describes.
        created_at: When the report was stored.
        hazard_type: Kind of condition on this report.
        category: Numeric code alongside the hazard type.
        text: What the member wrote, or the photo summary.
        has_photo: Whether the report has a photo.
        hazard_status: open or resolved.
        severity_score: Severity stored on the hazard, 0 through 100.
        latitude: North-south coordinate of the hazard.
        longitude: East-west coordinate of the hazard.
        floor: Floor the hazard sits on, or None.
        position: Normalized plan pin, or None.
        editable: True while the hazard is open.
        can_edit_location: True when the hazard is open and this is the
            only report on it.
    """

    id: UUID
    kind: Literal["photo", "text"]
    hazard_id: UUID
    created_at: datetime
    hazard_type: HazardType
    category: int
    text: str
    has_photo: bool
    hazard_status: HazardStatus
    severity_score: int
    latitude: float
    longitude: float
    floor: int | None = None
    position: PlanPosition | None = None
    editable: bool
    can_edit_location: bool


Report = Annotated[PhotoReport | TextReport, Field(discriminator="kind")]
