"""Alembic migration environment.

The database URL comes from the API settings, not from alembic.ini, so
the same DATABASE_URL drives the app and the migrations.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.alerts.models import Alert
from app.base import Base
from app.config import get_settings
from app.hazards.models import Hazard
from app.members.models import Member
from app.reports.models import Report

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

for _model in (Alert, Hazard, Member, Report):
    if _model.__table__.name not in Base.metadata.tables:
        raise RuntimeError(f"{_model.__tablename__} is not registered")

target_metadata = Base.metadata
config.set_main_option("sqlalchemy.url", get_settings().database_url)


def run_migrations_offline() -> None:
    """Emits migration SQL without opening a database connection."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Applies migrations against the configured database."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
