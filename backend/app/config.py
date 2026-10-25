"""Process settings loaded from the environment.

Required names are DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, and STORAGE_BUCKET. CORS_ORIGINS is
optional. The service role key uploads photo bytes. VISION_API_URL,
VISION_API_KEY, and VISION_MODEL configure the vision call. They are
optional here, and the call fails with "not configured" if any is blank.
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
        supabase_service_role_key: Service role key used to upload and
            delete photo objects. It stays on the server.
        storage_bucket: Object-storage bucket for photo reports.
        cors_origins: Comma-separated browser origins allowed to call
            the API.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    supabase_url: str = Field(min_length=1)
    supabase_anon_key: str = Field(min_length=1)
    supabase_service_role_key: str = Field(min_length=1)
    storage_bucket: str = Field(min_length=1)
    cors_origins: str = "http://localhost:8081"


class VisionSettings(BaseSettings):
    """Configuration for the vision call.

    Read on every call rather than cached, so a changed environment is
    picked up. A real environment variable wins over the .env file.

    Attributes:
        vision_api_url: Chat-completions endpoint for the vision call.
        vision_api_key: Bearer key for that endpoint.
        vision_model: Model name sent with each vision request.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vision_api_url: str = ""
    vision_api_key: str = ""
    vision_model: str = ""


@lru_cache
def get_settings() -> Settings:
    """Returns the process settings, loaded once.

    Returns:
        The cached settings instance.
    """
    return Settings()


def get_vision_settings() -> VisionSettings:
    """Reads the vision settings from the environment and .env.

    Returns:
        The current vision settings. Blank values mean not configured.
    """
    return VisionSettings()
