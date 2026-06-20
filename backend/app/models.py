import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    """App-local user, keyed on the platform's coders_id.

    coders.kr already knows who this visitor is (they signed in via
    `mcp.coders.kr/sso/login`); we keep a row in our own DB the first
    time we see them so app-local data can FK against a stable local UUID.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    coders_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), unique=True, nullable=False, index=True
    )
    display_name: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
    )


class Prompt(Base):
    """A versioned 'model' — a prompt that maps input to output.

    Two kinds: 'generator' (spec -> two explanations) and 'evaluator'
    (spec + A + B -> which is better, and why). Every session pins the
    exact prompt versions it used so the dataset is reproducible.
    """

    __tablename__ = "prompts"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False, index=True)
    # Monotonic per-kind version number, assigned at creation.
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    # The instruction text. Supports {spec} / {audience} (generator) and
    # {spec} / {a} / {b} (evaluator) placeholders.
    template: Mapped[str] = mapped_column(sa.Text, nullable=False)
    model: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    max_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=4000)
    temperature: Mapped[float] = mapped_column(sa.Float, nullable=False, default=1.0)
    # Exactly one prompt per kind is the active default for new sessions.
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )


class Session(Base):
    """One data point: a spec, two generated explanations, the evaluator's
    verdict, and the human's choice + reasons."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    spec: Mapped[str] = mapped_column(sa.Text, nullable=False)
    audience: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    generator_prompt_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("prompts.id", ondelete="RESTRICT"), nullable=False
    )
    evaluator_prompt_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("prompts.id", ondelete="RESTRICT"), nullable=True
    )
    # generating | generated | evaluated | done | error
    status: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, default="generating", index=True
    )
    error: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    archived: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false(), index=True
    )
    # Dataset split for the optimizer: 'train' | 'val' | 'none'. Assigned
    # deterministically when feedback lands (held-out 'val' gates updates).
    split: Mapped[str] = mapped_column(
        sa.String(8), nullable=False, default="none", server_default="none", index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )

    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    evaluation: Mapped["Evaluation | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan", uselist=False
    )
    feedback: Mapped["Feedback | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan", uselist=False
    )


class Candidate(Base):
    """One of the two generated explanations (label 'A' or 'B')."""

    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(sa.String(1), nullable=False)
    content: Mapped[str] = mapped_column(sa.Text, nullable=False)

    session: Mapped[Session] = relationship(back_populates="candidates")


class Evaluation(Base):
    """The Evaluator model's verdict over the two candidates."""

    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    evaluator_prompt_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("prompts.id", ondelete="RESTRICT"), nullable=False
    )
    winner: Mapped[str] = mapped_column(sa.String(1), nullable=False)
    reason: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    critique_a: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    critique_b: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    raw: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    session: Mapped[Session] = relationship(back_populates="evaluation")


class OptimizationRun(Base):
    """One optimization of a single prompt node (the autograd 'tape').

    Pins the base prompt version, dataset split, and config so the run is
    reproducible. Produces a candidate prompt that a human promotes to a
    real Prompt version (no silent drift).
    """

    __tablename__ = "optimization_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    target_kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    base_prompt_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("prompts.id", ondelete="RESTRICT"), nullable=False
    )
    loss_type: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    config: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    # running | awaiting_review | promoted | discarded | error
    status: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, default="running", index=True
    )
    error: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    train_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    val_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    base_val_score: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    best_step_idx: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    produced_prompt_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )

    steps: Mapped[list["OptimizationStep"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="OptimizationStep.idx",
    )


class OptimizationStep(Base):
    """One iteration of the optimization loop."""

    __tablename__ = "optimization_steps"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("optimization_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    idx: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    train_loss: Mapped[float] = mapped_column(sa.Float, nullable=False, default=0.0)
    val_score: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    gradient_text: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    candidate_prompt: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    accepted: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    records: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    run: Mapped[OptimizationRun] = relationship(back_populates="steps")


class Feedback(Base):
    """The human's verdict — the training signal for the Evaluator."""

    __tablename__ = "feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    choice: Mapped[str] = mapped_column(sa.String(1), nullable=False)
    # Why this one is easier to understand (the rich training material).
    reason: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    # How the explanation landed — what was clear / what was not.
    understanding: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    session: Mapped[Session] = relationship(back_populates="feedback")
