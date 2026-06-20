"""descriptive optimizer: run gap/candidate/optimizer_node + items table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-20 04:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "optimization_runs",
        sa.Column(
            "optimizer_prompt_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("prompts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "optimization_runs",
        sa.Column("aggregated_gap", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "optimization_runs",
        sa.Column("candidate_prompt", sa.Text(), nullable=False, server_default=""),
    )

    op.create_table(
        "optimization_items",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("optimization_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("spec", sa.Text(), nullable=False, server_default=""),
        sa.Column("forward_output", sa.Text(), nullable=False, server_default=""),
        sa.Column("loss_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("backward_text", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_optimization_items_run_id", "optimization_items", ["run_id"]
    )


def downgrade() -> None:
    op.drop_table("optimization_items")
    op.drop_column("optimization_runs", "candidate_prompt")
    op.drop_column("optimization_runs", "aggregated_gap")
    op.drop_column("optimization_runs", "optimizer_prompt_id")
