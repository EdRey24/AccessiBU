"""The facilities notice returned by a later route."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
