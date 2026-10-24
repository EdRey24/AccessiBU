"""Process settings loaded from the environment.

Required names are DATABASE_URL, JWT_SECRET, and STORAGE_BUCKET. The
storage bucket is unused by the current routes. It is loaded now so
later image uploads do not introduce a new required variable.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API process.

    Attributes:
        database_url: SQLAlchemy URL for the Postgres database.
        jwt_secret: HMAC secret used to sign bearer tokens.
        storage_bucket: Object-storage bucket reserved for image uploads.
        jwt_ttl_seconds: Lifetime of a login token. One day is a
            placeholder until session length is chosen.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    jwt_secret: str = Field(min_length=1)
    storage_bucket: str = Field(min_length=1)
    jwt_ttl_seconds: int = Field(default=86400, gt=0)


@lru_cache
def get_settings() -> Settings:
    """Returns the process settings, loaded once.

    Returns:
        The cached settings instance.
    """
    return Settings()
