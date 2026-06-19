"""add sessions.archived

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-19 16:40:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column(
            "archived", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_index("ix_sessions_archived", "sessions", ["archived"])


def downgrade() -> None:
    op.drop_index("ix_sessions_archived", table_name="sessions")
    op.drop_column("sessions", "archived")
