"""Seed the first Generator and Evaluator prompt versions.

Run once at startup; no-op if a prompt of that kind already exists.
These are deliberately editable from the UI — the whole point of the
project is to evolve them.
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import Prompt

GENERATOR_V1 = """\
당신은 어떤 개념이든 사람이 가장 잘 이해하도록 설명하는 전문가입니다.

주어진 '명세'(이해시키고자 하는 대상 지식)와 '대상 독자'를 바탕으로,
서로 접근 방식이 뚜렷하게 다른 두 가지 설명안 A와 B를 작성하세요.

원칙:
- 두 안은 전략이 달라야 합니다. (예: 한쪽은 비유/직관 중심, 다른 한쪽은 구조/원리 중심)
- 대상 독자의 사전 지식 수준에 맞추세요.
- 명세가 작성된 언어와 같은 언어로 설명하세요.
- 군더더기 없이, 핵심을 이해시키는 데 집중하세요.

[명세]
{spec}

[대상 독자]
{audience}
"""

EVALUATOR_V1 = """\
당신은 설명의 '인간 이해 용이성'을 평가하는 평가자입니다.

같은 명세에 대한 두 설명 A와 B 중, 사람이 더 쉽고 정확하게 이해할
설명을 고르세요.

판단 기준:
- 핵심 개념이 명확히 전달되는가
- 대상 독자가 따라가기 쉬운가 (인지 부하)
- 오해를 유발하지 않는가, 정확한가
- 군더더기 없이 본질에 도달하는가

화려함이나 분량이 아니라 '실제로 이해가 되는가'로 판단하세요.
"""


async def seed_prompts() -> None:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            existing = await session.execute(select(Prompt.kind).distinct())
            kinds = {row[0] for row in existing.all()}

            if "generator" not in kinds:
                session.add(
                    Prompt(
                        kind="generator",
                        version=1,
                        name="기본 Generator v1",
                        template=GENERATOR_V1,
                        model=settings.default_model,
                        max_tokens=4000,
                        temperature=1.0,
                        is_active=True,
                        notes="초기 시드 프롬프트.",
                    )
                )
            if "evaluator" not in kinds:
                session.add(
                    Prompt(
                        kind="evaluator",
                        version=1,
                        name="기본 Evaluator v1",
                        template=EVALUATOR_V1,
                        model=settings.default_model,
                        max_tokens=2000,
                        temperature=0.3,
                        is_active=True,
                        notes="초기 시드 프롬프트.",
                    )
                )
