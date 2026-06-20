"""Session flow — the data-collection core.

POST /api/sessions            create a session and run the Generator (A/B)
POST /api/sessions/{id}/evaluate   run the Evaluator over A/B
POST /api/sessions/{id}/feedback   record the human's choice + reasons
GET  /api/sessions            recent sessions (summary)
GET  /api/sessions/{id}       full detail
GET  /api/stats               dataset-level stats (evaluator↔human agreement)
"""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import llm
from app.core.database import get_session
from app.core.identity import optional_identity, require_identity
from app.models import Candidate, Evaluation, Feedback, Prompt, Session
from app.routes.prompts import get_active_prompt, prompt_out
from app.routes.users import upsert_local_user

router = APIRouter(prefix="/api", tags=["sessions"])


# ---- serialization -------------------------------------------------------


def _candidates_map(s: Session) -> dict[str, str]:
    return {c.label: c.content for c in s.candidates}


def parse_cards(content: str) -> list[dict]:
    """A candidate is stored as a JSON array of {title, body} step cards.

    Falls back to a single card for legacy plain-text/markdown content.
    """
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return [{"title": "", "body": content or ""}]
    if isinstance(data, list):
        out = [
            {"title": str(it.get("title", "")), "body": str(it.get("body", ""))}
            for it in data
            if isinstance(it, dict)
        ]
        return out or [{"title": "", "body": content}]
    return [{"title": "", "body": content or ""}]


def cards_to_text(cards: list[dict]) -> str:
    """Flatten step cards into markdown for the Evaluator."""
    parts = []
    for c in cards:
        title = c.get("title", "").strip()
        body = c.get("body", "").strip()
        parts.append(f"### {title}\n{body}" if title else body)
    return "\n\n".join(p for p in parts if p)


def session_detail(s: Session, prompts: dict[UUID, Prompt]) -> dict:
    cand = _candidates_map(s)
    ev = s.evaluation
    fb = s.feedback
    gen_p = prompts.get(s.generator_prompt_id)
    eval_p = prompts.get(s.evaluator_prompt_id) if s.evaluator_prompt_id else None
    agreement = None
    if ev and fb:
        agreement = ev.winner == fb.choice
    return {
        "id": str(s.id),
        "spec": s.spec,
        "audience": s.audience,
        "status": s.status,
        "error": s.error,
        "archived": s.archived,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "candidate_a": parse_cards(cand["A"]) if "A" in cand else [],
        "candidate_b": parse_cards(cand["B"]) if "B" in cand else [],
        "generator": prompt_out(gen_p) if gen_p else None,
        "evaluator": prompt_out(eval_p) if eval_p else None,
        "evaluation": (
            {
                "winner": ev.winner,
                "reason": ev.reason,
                "critique_a": ev.critique_a,
                "critique_b": ev.critique_b,
            }
            if ev
            else None
        ),
        "feedback": (
            {
                "choice": fb.choice,
                "reason": fb.reason,
                "understanding": fb.understanding,
            }
            if fb
            else None
        ),
        "agreement": agreement,
    }


async def _load_prompts(
    session: AsyncSession, ids: set[UUID]
) -> dict[UUID, Prompt]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    res = await session.execute(select(Prompt).where(Prompt.id.in_(ids)))
    return {p.id: p for p in res.scalars().all()}


async def _get_full_session(session: AsyncSession, session_id: UUID) -> Session:
    res = await session.execute(
        select(Session)
        .options(
            selectinload(Session.candidates),
            selectinload(Session.evaluation),
            selectinload(Session.feedback),
        )
        .where(Session.id == session_id)
    )
    s = res.scalar_one_or_none()
    if s is None:
        raise HTTPException(404, "session not found")
    return s


# ---- create + generate ---------------------------------------------------


class SessionIn(BaseModel):
    spec: str = Field(min_length=1, max_length=8000)
    audience: str = Field(default="", max_length=2000)
    generator_prompt_id: UUID | None = None
    evaluator_prompt_id: UUID | None = None


@router.post("/sessions", status_code=201)
async def create_session(
    body: SessionIn,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await upsert_local_user(session, coders_id)

    if body.generator_prompt_id:
        gen = (
            await session.execute(
                select(Prompt).where(Prompt.id == body.generator_prompt_id)
            )
        ).scalar_one_or_none()
    else:
        gen = await get_active_prompt(session, "generator")
    if gen is None or gen.kind != "generator":
        raise HTTPException(400, "no generator prompt available")

    # The evaluator is pinned now (so the dataset records it) but only run
    # on the explicit /evaluate call.
    if body.evaluator_prompt_id:
        ev_prompt = (
            await session.execute(
                select(Prompt).where(Prompt.id == body.evaluator_prompt_id)
            )
        ).scalar_one_or_none()
    else:
        ev_prompt = await get_active_prompt(session, "evaluator")

    s = Session(
        spec=body.spec.strip(),
        audience=body.audience.strip(),
        generator_prompt_id=gen.id,
        evaluator_prompt_id=ev_prompt.id if ev_prompt else None,
        status="generating",
        created_by=user.id,
    )
    session.add(s)
    await session.flush()

    try:
        a_cards, b_cards, _raw = await llm.run_generator(
            template=gen.template,
            model=gen.model,
            max_tokens=gen.max_tokens,
            temperature=gen.temperature,
            spec=s.spec,
            audience=s.audience,
            coders_user=coders_id,
        )
        if not a_cards or not b_cards:
            raise ValueError("generator returned empty candidate")
        session.add_all(
            [
                Candidate(
                    session_id=s.id,
                    label="A",
                    content=json.dumps(a_cards, ensure_ascii=False),
                ),
                Candidate(
                    session_id=s.id,
                    label="B",
                    content=json.dumps(b_cards, ensure_ascii=False),
                ),
            ]
        )
        s.status = "generated"
    except Exception as e:  # noqa: BLE001 — surface to the client
        s.status = "error"
        s.error = f"generation failed: {e}"
        await session.flush()
        raise HTTPException(502, s.error) from e

    await session.flush()
    full = await _get_full_session(session, s.id)
    prompts = await _load_prompts(
        session, {full.generator_prompt_id, full.evaluator_prompt_id}
    )
    return session_detail(full, prompts)


@router.post("/sessions/{session_id}/evaluate")
async def evaluate_session(
    session_id: UUID,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    s = await _get_full_session(session, session_id)
    cand = _candidates_map(s)
    if "A" not in cand or "B" not in cand:
        raise HTTPException(400, "session has no candidates yet")
    if s.evaluation is not None:
        prompts = await _load_prompts(
            session, {s.generator_prompt_id, s.evaluator_prompt_id}
        )
        return session_detail(s, prompts)

    ev_prompt = None
    if s.evaluator_prompt_id:
        ev_prompt = (
            await session.execute(
                select(Prompt).where(Prompt.id == s.evaluator_prompt_id)
            )
        ).scalar_one_or_none()
    if ev_prompt is None:
        ev_prompt = await get_active_prompt(session, "evaluator")
    if ev_prompt is None:
        raise HTTPException(400, "no evaluator prompt available")

    try:
        result = await llm.run_evaluator(
            template=ev_prompt.template,
            model=ev_prompt.model,
            max_tokens=ev_prompt.max_tokens,
            temperature=ev_prompt.temperature,
            spec=s.spec,
            a=cards_to_text(parse_cards(cand["A"])),
            b=cards_to_text(parse_cards(cand["B"])),
            coders_user=coders_id,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"evaluation failed: {e}") from e

    session.add(
        Evaluation(
            session_id=s.id,
            evaluator_prompt_id=ev_prompt.id,
            winner=result["winner"],
            reason=result["reason"],
            critique_a=result["critique_a"],
            critique_b=result["critique_b"],
            raw=result["raw"],
        )
    )
    s.evaluator_prompt_id = ev_prompt.id
    if s.status in ("generated", "generating"):
        s.status = "evaluated"
    await session.flush()
    s = await _get_full_session(session, s.id)
    prompts = await _load_prompts(
        session, {s.generator_prompt_id, s.evaluator_prompt_id}
    )
    return session_detail(s, prompts)


class FeedbackIn(BaseModel):
    choice: str
    reason: str = Field(default="", max_length=8000)
    understanding: str = Field(default="", max_length=8000)


@router.post("/sessions/{session_id}/feedback")
async def submit_feedback(
    session_id: UUID,
    body: FeedbackIn,
    coders_id: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    choice = body.choice.strip().upper()
    if choice not in ("A", "B"):
        raise HTTPException(400, "choice must be 'A' or 'B'")
    s = await _get_full_session(session, session_id)
    user = await upsert_local_user(session, coders_id)
    if s.feedback is not None:
        fb = s.feedback
        fb.choice = choice
        fb.reason = body.reason.strip()
        fb.understanding = body.understanding.strip()
        fb.user_id = user.id
    else:
        session.add(
            Feedback(
                session_id=s.id,
                user_id=user.id,
                choice=choice,
                reason=body.reason.strip(),
                understanding=body.understanding.strip(),
            )
        )
    s.status = "done"
    if s.split == "none":
        # Deterministic train/val assignment for the optimizer dataset.
        from app.optimizer import assign_split

        s.split = assign_split(s.id)
    await session.flush()
    s = await _get_full_session(session, s.id)
    prompts = await _load_prompts(
        session, {s.generator_prompt_id, s.evaluator_prompt_id}
    )
    return session_detail(s, prompts)


class ArchiveIn(BaseModel):
    archived: bool = True


@router.post("/sessions/{session_id}/archive")
async def archive_session(
    session_id: UUID,
    body: ArchiveIn,
    _: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    s = await _get_full_session(session, session_id)
    s.archived = body.archived
    await session.flush()
    s = await _get_full_session(session, s.id)
    prompts = await _load_prompts(
        session, {s.generator_prompt_id, s.evaluator_prompt_id}
    )
    return session_detail(s, prompts)


# ---- listing + stats -----------------------------------------------------


@router.get("/sessions")
async def list_sessions(
    archived: bool = False,
    session: AsyncSession = Depends(get_session),
    _: UUID | None = Depends(optional_identity),
) -> list[dict]:
    res = await session.execute(
        select(Session)
        .options(
            selectinload(Session.evaluation),
            selectinload(Session.feedback),
        )
        .where(Session.archived.is_(archived))
        .order_by(desc(Session.created_at))
        .limit(60)
    )
    out = []
    for s in res.scalars().all():
        ev, fb = s.evaluation, s.feedback
        agreement = ev.winner == fb.choice if (ev and fb) else None
        out.append(
            {
                "id": str(s.id),
                "spec": s.spec[:160],
                "audience": s.audience[:80],
                "status": s.status,
                "has_evaluation": ev is not None,
                "has_feedback": fb is not None,
                "agreement": agreement,
                "archived": s.archived,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
        )
    return out


@router.get("/sessions/{session_id}")
async def get_session_detail(
    session_id: UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    s = await _get_full_session(session, session_id)
    prompts = await _load_prompts(
        session, {s.generator_prompt_id, s.evaluator_prompt_id}
    )
    return session_detail(s, prompts)


@router.get("/stats")
async def stats(session: AsyncSession = Depends(get_session)) -> dict:
    total = (
        await session.execute(select(func.count()).select_from(Session))
    ).scalar_one()
    evaluated = (
        await session.execute(select(func.count()).select_from(Evaluation))
    ).scalar_one()
    feedbacks = (
        await session.execute(select(func.count()).select_from(Feedback))
    ).scalar_one()

    # Agreement among sessions that have BOTH an evaluation and feedback.
    pair = (
        await session.execute(
            select(Evaluation.winner, Feedback.choice).join(
                Feedback, Feedback.session_id == Evaluation.session_id
            )
        )
    ).all()
    agree = sum(1 for w, c in pair if w == c)
    return {
        "total_sessions": total,
        "evaluated": evaluated,
        "feedbacks": feedbacks,
        "labeled_pairs": len(pair),
        "agreements": agree,
        "agreement_rate": (agree / len(pair)) if pair else None,
    }
