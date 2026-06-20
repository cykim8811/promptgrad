"""optimizer: sessions.split + optimization_runs + optimization_steps

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-19 17:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("split", sa.String(8), nullable=False, server_default="none"),
    )
    op.create_index("ix_sessions_split", "sessions", ["split"])

    op.create_table(
        "optimization_runs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column(
            "base_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("loss_type", sa.String(32), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("train_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("val_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("base_val_score", sa.Float(), nullable=True),
        sa.Column("best_step_idx", sa.Integer(), nullable=True),
        sa.Column(
            "produced_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
    op.create_index("ix_optimization_runs_status", "optimization_runs", ["status"])
    op.create_index(
        "ix_optimization_runs_created_by", "optimization_runs", ["created_by"]
    )
    op.create_index(
        "ix_optimization_runs_created_at", "optimization_runs", ["created_at"]
    )

    op.create_table(
        "optimization_steps",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("optimization_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idx", sa.Integer(), nullable=False),
        sa.Column("train_loss", sa.Float(), nullable=False, server_default="0"),
        sa.Column("val_score", sa.Float(), nullable=True),
        sa.Column("gradient_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("candidate_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "accepted", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("records", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_optimization_steps_run_id", "optimization_steps", ["run_id"]
    )


def downgrade() -> None:
    op.drop_table("optimization_steps")
    op.drop_table("optimization_runs")
    op.drop_index("ix_sessions_split", table_name="sessions")
    op.drop_column("sessions", "split")
