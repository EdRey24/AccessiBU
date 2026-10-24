"""The members table.

A row is inserted by a database trigger when Supabase creates an auth
user. This service does not store a password.
"""

import enum
import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, false
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.base import Base, value_enum


class MemberRole(enum.StrEnum):
    """A label on a member. Admin powers are not defined yet."""

    MEMBER = "member"
    ADMIN = "admin"


class Member(Base):
    """A person registered under one @bu.edu address.

    The id is the Supabase auth user id. The address is fixed after
    the row is inserted.

    Attributes:
        id: Primary key, equal to the auth user id.
        email: Sign-in address. It must end in @bu.edu.
        role: member or admin. The insert trigger always stores member.
        mobility_preference: Whether the person needs a barrier-free
            path. Unused until routing exists.
    """

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint(
            "email LIKE '%@bu.edu'",
            name="ck_members_email_domain",
        ),
        CheckConstraint(
            "role IN ('member', 'admin')",
            name="ck_members_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "auth.users.id",
            name="fk_members_auth_user",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
    email: Mapped[str] = mapped_column(String(255), unique=True)
    role: Mapped[MemberRole] = mapped_column(
        value_enum(MemberRole, "ck_members_role"),
        default=MemberRole.MEMBER,
        server_default=MemberRole.MEMBER.value,
    )
    mobility_preference: Mapped[bool] = mapped_column(
        default=False,
        server_default=false(),
    )
