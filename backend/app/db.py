"""Database engine and request-scoped sessions."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

engine = create_engine(
    get_settings().database_url,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


def get_db() -> Iterator[Session]:
    """Yields a session and closes it when the request finishes.

    Yields:
        An open SQLAlchemy session bound to the process engine.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
