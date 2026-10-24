"""Process settings loaded from the environment.

Required names are DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, and STORAGE_BUCKET.
The service role key and storage bucket are unused by the current
routes. They are loaded now so later image uploads do not introduce a
new required variable.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API process.

    Attributes:
        database_url: SQLAlchemy URL for the Postgres database.
        supabase_url: Project URL, without a trailing path.
        supabase_anon_key: Anon key used to call Supabase Auth. It stays
            on the server.
        supabase_service_role_key: Service role key reserved for later
            uploads. Unused by the current routes.
        supabase_jwt_secret: Shared secret used to verify access tokens.
            This service does not sign tokens with it.
        storage_bucket: Object-storage bucket reserved for image uploads.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    supabase_url: str = Field(min_length=1)
    supabase_anon_key: str = Field(min_length=1)
    supabase_service_role_key: str = Field(min_length=1)
    supabase_jwt_secret: str = Field(min_length=1)
    storage_bucket: str = Field(min_length=1)


@lru_cache
def get_settings() -> Settings:
    """Returns the process settings, loaded once.

    Returns:
        The cached settings instance.
    """
    return Settings()
