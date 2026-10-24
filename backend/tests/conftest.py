# ruff: noqa: E402
"""SQLite fixtures for report storage tests.

Environment variables are set before the app is imported so the process
engine never points at a hosted database.
"""

import os
import tempfile

_DATABASE_FD, _DATABASE_PATH = tempfile.mkstemp(suffix=".sqlite")
os.close(_DATABASE_FD)
os.environ["DATABASE_URL"] = f"sqlite:///{_DATABASE_PATH}"
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "anon"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service"
os.environ["STORAGE_BUCKET"] = "hazard-images"

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Column, Table, create_engine, event, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session, sessionmaker

import app.alerts.models  # noqa: F401
import app.hazards.models  # noqa: F401
import app.reports.models  # noqa: F401
from app.base import Base
from app.db import get_db
from app.main import app
from app.members.deps import current_member
from app.members.models import Member, MemberRole

MEMBER_ID = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")

engine = create_engine(
    f"sqlite:///{_DATABASE_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _prepare_connection(dbapi_connection, _record) -> None:
    """Enables foreign keys and the auth schema Supabase provides.

    Args:
        dbapi_connection: The new SQLite connection.
        _record: Unused SQLAlchemy connection record.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("ATTACH DATABASE ':memory:' AS auth")
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS auth.users (id VARCHAR(36) PRIMARY KEY)",
    )
    cursor.close()


class FlakySession(Session):
    """A session whose commit can be forced to fail."""

    fail_commit = False

    def commit(self, *args, **kwargs):
        """Commits, or raises when a test asks it to fail.

        Args:
            *args: Forwarded to Session.commit.
            **kwargs: Forwarded to Session.commit.

        Returns:
            The result of Session.commit.

        Raises:
            RuntimeError: The test set fail_commit.
        """
        if self.fail_commit:
            raise RuntimeError("disk")
        return super().commit(*args, **kwargs)


SessionLocal = sessionmaker(
    bind=engine,
    class_=FlakySession,
    autoflush=False,
    autocommit=False,
)


@pytest.fixture(scope="session", autouse=True)
def _create_tables() -> None:
    """Creates the API tables once for the test process."""
    if "auth.users" not in Base.metadata.tables:
        Table(
            "users",
            Base.metadata,
            Column("id", UUID(as_uuid=True), primary_key=True),
            schema="auth",
        )
    Base.metadata.create_all(engine)


@pytest.fixture
def sessions():
    """Returns the session factory bound to the test database.

    Returns:
        A callable that opens a session on the test database.
    """
    return SessionLocal


@pytest.fixture
def objects() -> dict[str, tuple[bytes, str]]:
    """Returns the in-memory bucket for one test.

    Returns:
        Object key to (bytes, content type).
    """
    return {}


@pytest.fixture
def state() -> dict[str, bool]:
    """Returns the per-test commit flag.

    Returns:
        A flag dictionary tests can set before a request.
    """
    return {"fail_commit": False}


@pytest.fixture
def client(
    objects: dict[str, tuple[bytes, str]],
    state: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    """Serves the API against SQLite and an in-memory bucket.

    Args:
        objects: The in-memory bucket.
        state: The commit flag.
        monkeypatch: Pytest patch helper.

    Yields:
        A client whose member is already signed in.
    """

    def put_object(path: str, body: bytes, content_type: str) -> None:
        objects[path] = (body, content_type)

    def delete_object(path: str) -> None:
        objects.pop(path, None)

    monkeypatch.setattr("app.reports.service.put_object", put_object)
    monkeypatch.setattr("app.reports.service.delete_object", delete_object)

    def override_db() -> Iterator[Session]:
        session = SessionLocal()
        session.fail_commit = state["fail_commit"]
        try:
            yield session
        finally:
            session.close()

    def override_member() -> Member:
        return Member(
            id=MEMBER_ID,
            email="ada@bu.edu",
            role=MemberRole.MEMBER,
            mobility_preference=False,
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[current_member] = override_member
    try:
        _reset()
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def _reset() -> None:
    """Deletes rows left by the previous test."""
    with SessionLocal() as session:
        session.execute(text("DELETE FROM reports"))
        session.execute(text("DELETE FROM alerts"))
        session.execute(text("DELETE FROM hazards"))
        session.execute(text("DELETE FROM members"))
        session.execute(text("DELETE FROM auth.users"))
        session.execute(
            text("INSERT INTO auth.users (id) VALUES (:id)"),
            {"id": str(MEMBER_ID)},
        )
        session.add(
            Member(
                id=MEMBER_ID,
                email="ada@bu.edu",
                role=MemberRole.MEMBER,
                mobility_preference=False,
            ),
        )
        session.commit()
