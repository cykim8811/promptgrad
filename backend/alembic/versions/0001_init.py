"""initial schema: users, prompts, sessions, candidates, evaluations, feedbacks

Revision ID: 0001
Revises:
Create Date: 2026-06-19 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("coders_id", sa.UUID(as_uuid=True), unique=True, nullable=False),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_users_coders_id", "users", ["coders_id"])

    op.create_table(
        "prompts",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="4000"),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_prompts_kind", "prompts", ["kind"])
    op.create_index("ix_prompts_created_at", "prompts", ["created_at"])

    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("spec", sa.Text(), nullable=False),
        sa.Column("audience", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "generator_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "evaluator_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="generating"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_sessions_status", "sessions", ["status"])
    op.create_index("ix_sessions_created_by", "sessions", ["created_by"])
    op.create_index("ix_sessions_created_at", "sessions", ["created_at"])

    op.create_table(
        "candidates",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(1), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
    )
    op.create_index("ix_candidates_session_id", "candidates", ["session_id"])

    op.create_table(
        "evaluations",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "evaluator_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("winner", sa.String(1), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("critique_a", sa.Text(), nullable=False, server_default=""),
        sa.Column("critique_b", sa.Text(), nullable=False, server_default=""),
        sa.Column("raw", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_evaluations_session_id", "evaluations", ["session_id"])

    op.create_table(
        "feedbacks",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("choice", sa.String(1), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("understanding", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_feedbacks_session_id", "feedbacks", ["session_id"])


def downgrade() -> None:
    op.drop_table("feedbacks")
    op.drop_table("evaluations")
    op.drop_table("candidates")
    op.drop_table("sessions")
    op.drop_table("prompts")
    op.drop_index("ix_users_coders_id", table_name="users")
    op.drop_table("users")
