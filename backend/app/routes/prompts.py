"""Prompt (a.k.a. 'model') version management.

A 'model' here is a prompt that maps input to output. Each kind
('generator' / 'evaluator') has a stack of versions; one is active.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.identity import require_identity
from app.models import Prompt

router = APIRouter(prefix="/api/prompts", tags=["prompts"])

KINDS = ("generator", "evaluator")


def prompt_out(p: Prompt) -> dict:
    return {
        "id": str(p.id),
        "kind": p.kind,
        "version": p.version,
        "name": p.name,
        "template": p.template,
        "model": p.model,
        "max_tokens": p.max_tokens,
        "temperature": p.temperature,
        "is_active": p.is_active,
        "notes": p.notes,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


async def get_active_prompt(session: AsyncSession, kind: str) -> Prompt | None:
    res = await session.execute(
        select(Prompt).where(Prompt.kind == kind, Prompt.is_active.is_(True))
    )
    return res.scalar_one_or_none()


@router.get("")
async def list_prompts(
    session: AsyncSession = Depends(get_session),
) -> dict:
    res = await session.execute(
        select(Prompt).order_by(Prompt.kind, Prompt.version.desc())
    )
    rows = res.scalars().all()
    out: dict[str, list[dict]] = {k: [] for k in KINDS}
    for p in rows:
        out.setdefault(p.kind, []).append(prompt_out(p))
    return out


@router.get("/models")
async def list_models() -> dict:
    return {"models": settings.allowed_model_list, "default": settings.default_model}


@router.get("/{prompt_id}")
async def get_prompt(
    prompt_id: UUID, session: AsyncSession = Depends(get_session)
) -> dict:
    res = await session.execute(select(Prompt).where(Prompt.id == prompt_id))
    p = res.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "prompt not found")
    return prompt_out(p)


class PromptIn(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=120)
    template: str = Field(min_length=1)
    model: str | None = None
    max_tokens: int = Field(default=4000, ge=256, le=16000)
    temperature: float = Field(default=1.0, ge=0.0, le=1.0)
    notes: str = ""
    activate: bool = True


@router.post("", status_code=201)
async def create_prompt(
    body: PromptIn,
    _: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {KINDS}")
    model = body.model or settings.default_model
    if model not in settings.allowed_model_list:
        raise HTTPException(400, f"model not allowed: {model}")

    next_version = (
        await session.execute(
            select(func.coalesce(func.max(Prompt.version), 0) + 1).where(
                Prompt.kind == body.kind
            )
        )
    ).scalar_one()

    if body.activate:
        await session.execute(
            update(Prompt).where(Prompt.kind == body.kind).values(is_active=False)
        )

    p = Prompt(
        kind=body.kind,
        version=next_version,
        name=body.name.strip(),
        template=body.template,
        model=model,
        max_tokens=body.max_tokens,
        temperature=body.temperature,
        notes=body.notes.strip(),
        is_active=body.activate,
    )
    session.add(p)
    await session.flush()
    return prompt_out(p)


@router.post("/{prompt_id}/activate")
async def activate_prompt(
    prompt_id: UUID,
    _: UUID = Depends(require_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    res = await session.execute(select(Prompt).where(Prompt.id == prompt_id))
    p = res.scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "prompt not found")
    await session.execute(
        update(Prompt).where(Prompt.kind == p.kind).values(is_active=False)
    )
    p.is_active = True
    await session.flush()
    return prompt_out(p)
