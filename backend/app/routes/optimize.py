"""Optimizer API — descriptive, human-gated.

Start a run (one forward→loss→backward→aggregate→optimizer pass), poll it,
read the per-example gaps + the single candidate prompt, and promote or
discard by hand. No automatic scalar/gate.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_session
from app.core.identity import optional_identity, require_identity
from app.models import (
    Feedback,
    OptimizationItem,
    OptimizationRun,
    Prompt,
    Session,
)
from app.optimizer import run_optimization
from app.routes.prompts import get_active_prompt, prompt_out

router = APIRouter(prefix="/api", tags=["optimize"])

TARGET_KINDS = ("evaluator", "generator")

DEFAULT_CONFIG = {
    "model": settings.default_model,
    "judge_model": settings.default_model,
    "eval_max_tokens": 1200,
    "eval_temperature": 0.2,
    "gen_max_tokens": 4000,
    "gen_temperature": 1.0,
}


# ---- serialization ---------------------------------------------------------


def run_out(run: OptimizationRun, items: list[OptimizationItem] | None = None) -> dict:
    d = {
        "id": str(run.id),
        "target_kind": run.target_kind,
        "base_prompt_id": str(run.base_prompt_id),
        "optimizer_prompt_id": (
            str(run.optimizer_prompt_id) if run.optimizer_prompt_id else None
        ),
        "status": run.status,
        "error": run.error,
        "example_count": run.train_count,
        "aggregated_gap": run.aggregated_gap,
        "candidate_prompt": run.candidate_prompt,
        "produced_prompt_id": (
            str(run.produced_prompt_id) if run.produced_prompt_id else None
        ),
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    if items is not None:
        d["items"] = [item_out(i) for i in items]
    return d


def item_out(i: OptimizationItem) -> dict:
    return {
        "session_id": str(i.session_id) if i.session_id else None,
        "spec": i.spec,
        "forward_output": i.forward_output,
        "loss_text": i.loss_text,
        "backward_text": i.backward_text,
    }


# ---- dataset stats ---------------------------------------------------------


@router.get("/dataset/stats")
async def dataset_stats(
    session: AsyncSession = Depends(get_session),
    _: UUID | None = Depends(optional_identity),
) -> dict:
    res = await session.execute(
        select(Session)
        .options(selectinload(Session.evaluation), selectinload(Session.feedback))
        .join(Feedback, Feedback.session_id == Session.id)
    )
    rows = res.scalars().all()
    with_reason = sum(1 for s in rows if s.feedback and s.feedback.reason.strip())
    disagree = sum(
        1
        for s in rows
        if s.evaluation and s.feedback and s.evaluation.winner != s.feedback.choice
    )
    return {
        "labeled": len(rows),
        "with_reason": with_reason,
        "disagreements": disagree,
    }


# ---- start a run -----------------------------------------------------------


class OptimizeIn(BaseModel):
    target_kind: str = "evaluator"
    base_prompt_id: UUID | None = None
    config: dict = Field(default_factory=dict)


@router.post("/optimize", status_code=201)
async def start_optimize(
    body: OptimizeIn,
    background: BackgroundTasks,
    coders_id: UUID = Depends(require_identity),
) -> dict:
    if body.target_kind not in TARGET_KINDS:
        raise HTTPException(400, "target_kind must be 'evaluator' or 'generator'.")

    from app.routes.users import upsert_local_user

    async with AsyncSessionLocal() as session:
        async with session.begin():
            if body.base_prompt_id:
                base = (
                    await session.execute(
                        select(Prompt).where(Prompt.id == body.base_prompt_id)
                    )
                ).scalar_one_or_none()
            else:
                base = await get_active_prompt(session, body.target_kind)
            if base is None or base.kind != body.target_kind:
                raise HTTPException(400, "base 프롬프트를 찾을 수 없습니다.")

            optimizer = await get_active_prompt(session, "optimizer")
            if optimizer is None:
                raise HTTPException(400, "활성 Optimizer 노드가 없습니다.")

            cfg = {**DEFAULT_CONFIG, **(body.config or {})}
            for m in ("model", "judge_model"):
                if cfg.get(m) not in settings.allowed_model_list:
                    cfg[m] = settings.default_model

            user = await upsert_local_user(session, coders_id)
            run = OptimizationRun(
                id=uuid4(),
                target_kind=body.target_kind,
                base_prompt_id=base.id,
                optimizer_prompt_id=optimizer.id,
                loss_type="descriptive",
                config=cfg,
                status="running",
                created_by=user.id,
            )
            session.add(run)
        run_id = run.id
        out = run_out(run)

    background.add_task(run_optimization, run_id)
    return out


@router.get("/optimize")
async def list_runs(
    session: AsyncSession = Depends(get_session),
    _: UUID | None = Depends(optional_identity),
) -> list[dict]:
    res = await session.execute(
        select(OptimizationRun).order_by(desc(OptimizationRun.created_at)).limit(40)
    )
    return [run_out(r) for r in res.scalars().all()]


@router.get("/optimize/{run_id}")
async def get_run(
    run_id: UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    res = await session.execute(
        select(OptimizationRun)
        .options(selectinload(OptimizationRun.items))
        .where(OptimizationRun.id == run_id)
    )
    run = res.scalar_one_or_none()
    if run is None:
        raise HTTPException(404, "run not found")
    base = (
        await session.execute(select(Prompt).where(Prompt.id == run.base_prompt_id))
    ).scalar_one_or_none()
    out = run_out(run, list(run.items))
    out["base_prompt"] = prompt_out(base) if base else None
    return out


# ---- promote / discard -----------------------------------------------------


class PromoteIn(BaseModel):
    activate: bool = False
    name: str | None = None


@router.post("/optimize/{run_id}/promote")
async def promote_run(
    run_id: UUID,
    body: PromoteIn,
    _: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    run = (
        await session.execute(
            select(OptimizationRun).where(OptimizationRun.id == run_id)
        )
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(404, "run not found")
    if not run.candidate_prompt:
        raise HTTPException(400, "승격할 후보 프롬프트가 없습니다.")

    base = (
        await session.execute(select(Prompt).where(Prompt.id == run.base_prompt_id))
    ).scalar_one()
    next_version = (
        await session.execute(
            select(func.coalesce(func.max(Prompt.version), 0) + 1).where(
                Prompt.kind == run.target_kind
            )
        )
    ).scalar_one()

    if body.activate:
        from sqlalchemy import update

        await session.execute(
            update(Prompt).where(Prompt.kind == run.target_kind).values(is_active=False)
        )

    p = Prompt(
        kind=run.target_kind,
        version=next_version,
        name=body.name or f"opt v{next_version} (run {str(run.id)[:8]})",
        template=run.candidate_prompt,
        model=base.model,
        max_tokens=base.max_tokens,
        temperature=base.temperature,
        notes=f"optimizer 산출 · base v{base.version}",
        is_active=body.activate,
    )
    session.add(p)
    await session.flush()
    run.produced_prompt_id = p.id
    run.status = "promoted"
    return {"run": run_out(run), "prompt": prompt_out(p)}


@router.post("/optimize/{run_id}/discard")
async def discard_run(
    run_id: UUID,
    _: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    run = (
        await session.execute(
            select(OptimizationRun).where(OptimizationRun.id == run_id)
        )
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(404, "run not found")
    run.status = "discarded"
    return run_out(run)
