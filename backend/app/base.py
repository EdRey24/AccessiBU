"""Shared SQLAlchemy metadata.

Importing this module does not open a database connection.
"""

import enum

from sqlalchemy import Enum
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared metadata for the API tables."""


def value_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    """Builds a varchar enum that stores the member value.

    Args:
        enum_cls: The Python enum whose values are persisted.
        name: Identifier for the non-native enum type.

    Returns:
        A non-native SQLAlchemy enum. Values such as "member" are
        stored, rather than the Python member name.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=False,
        length=32,
        values_callable=lambda choices: [choice.value for choice in choices],
    )
