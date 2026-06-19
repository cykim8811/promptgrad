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
