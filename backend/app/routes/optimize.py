"""Optimizer API — start runs, poll progress, promote/discard candidates."""

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
    OptimizationRun,
    OptimizationStep,
    Prompt,
    Session,
)
from app.optimizer import assign_split, run_optimization
from app.routes.prompts import get_active_prompt, prompt_out

router = APIRouter(prefix="/api", tags=["optimize"])

LOSS_TYPES = ("rationale_recovery",)

DEFAULT_CONFIG = {
    "n_iters": 3,
    "batch_size": 4,
    "length_cap": 600,
    "w_choice": 0.4,
    "w_cov": 0.6,
    "stop": 0.05,
    "model": settings.default_model,
    "judge_model": settings.default_model,
    "eval_max_tokens": 1200,
    "eval_temperature": 0.2,
}


# ---- serialization ---------------------------------------------------------


def run_out(run: OptimizationRun, steps: list[OptimizationStep] | None = None) -> dict:
    d = {
        "id": str(run.id),
        "target_kind": run.target_kind,
        "base_prompt_id": str(run.base_prompt_id),
        "loss_type": run.loss_type,
        "config": run.config,
        "status": run.status,
        "error": run.error,
        "train_count": run.train_count,
        "val_count": run.val_count,
        "base_val_score": run.base_val_score,
        "best_step_idx": run.best_step_idx,
        "produced_prompt_id": (
            str(run.produced_prompt_id) if run.produced_prompt_id else None
        ),
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    if steps is not None:
        d["steps"] = [step_out(s) for s in steps]
    return d


def step_out(s: OptimizationStep) -> dict:
    return {
        "idx": s.idx,
        "train_loss": s.train_loss,
        "val_score": s.val_score,
        "gradient_text": s.gradient_text,
        "candidate_prompt": s.candidate_prompt,
        "accepted": s.accepted,
        "records": s.records,
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
    train = val = disagree = 0
    for s in rows:
        split = s.split if s.split in ("train", "val") else assign_split(s.id)
        if split == "val":
            val += 1
        else:
            train += 1
        if s.evaluation and s.feedback and s.evaluation.winner != s.feedback.choice:
            disagree += 1
    return {
        "labeled": len(rows),
        "train": train,
        "val": val,
        "disagreements": disagree,
    }


# ---- start a run -----------------------------------------------------------


class OptimizeIn(BaseModel):
    target_kind: str = "evaluator"
    base_prompt_id: UUID | None = None
    loss_type: str = "rationale_recovery"
    config: dict = Field(default_factory=dict)


@router.post("/optimize", status_code=201)
async def start_optimize(
    body: OptimizeIn,
    background: BackgroundTasks,
    coders_id: UUID = Depends(require_identity),
) -> dict:
    if body.target_kind != "evaluator":
        raise HTTPException(400, "현재는 target_kind='evaluator'만 지원합니다.")
    if body.loss_type not in LOSS_TYPES:
        raise HTTPException(400, f"loss_type must be one of {LOSS_TYPES}")

    from app.routes.users import upsert_local_user

    # Own short-lived transaction so the run is durably committed BEFORE the
    # background task (and before the response) — not racing get_session's
    # deferred commit against BackgroundTasks ordering.
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

            cfg = {**DEFAULT_CONFIG, **(body.config or {})}
            cfg["n_iters"] = max(1, min(int(cfg["n_iters"]), 8))
            cfg["batch_size"] = max(1, min(int(cfg["batch_size"]), 16))
            cfg["length_cap"] = max(120, min(int(cfg["length_cap"]), 4000))
            for m in ("model", "judge_model"):
                if cfg[m] not in settings.allowed_model_list:
                    cfg[m] = settings.default_model

            user = await upsert_local_user(session, coders_id)
            run = OptimizationRun(
                id=uuid4(),
                target_kind=body.target_kind,
                base_prompt_id=base.id,
                loss_type=body.loss_type,
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
        .options(selectinload(OptimizationRun.steps))
        .where(OptimizationRun.id == run_id)
    )
    run = res.scalar_one_or_none()
    if run is None:
        raise HTTPException(404, "run not found")
    base = (
        await session.execute(select(Prompt).where(Prompt.id == run.base_prompt_id))
    ).scalar_one_or_none()
    out = run_out(run, list(run.steps))
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
    res = await session.execute(
        select(OptimizationRun)
        .options(selectinload(OptimizationRun.steps))
        .where(OptimizationRun.id == run_id)
    )
    run = res.scalar_one_or_none()
    if run is None:
        raise HTTPException(404, "run not found")
    if run.best_step_idx is None:
        raise HTTPException(400, "승격할 개선 후보가 없습니다 (검증을 통과한 스텝 없음).")
    best = next((s for s in run.steps if s.idx == run.best_step_idx), None)
    if best is None or not best.candidate_prompt:
        raise HTTPException(400, "후보 프롬프트를 찾을 수 없습니다.")

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
        template=best.candidate_prompt,
        model=base.model,
        max_tokens=base.max_tokens,
        temperature=base.temperature,
        notes=f"optimizer 산출 · base v{base.version} · val {run.base_val_score}→{best.val_score}",
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
