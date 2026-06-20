"""Seed the first Generator and Evaluator prompt versions.

Run once at startup; no-op if a prompt of that kind already exists.
These are deliberately editable from the UI — the whole point of the
project is to evolve them.
"""

from __future__ import annotations

from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import Prompt

SEED_NOTE = "초기 시드 프롬프트."

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

OPTIMIZER_V1 = """\
당신은 프롬프트를 개선하는 옵티마이저입니다.

입력으로 (1) 어떤 노드의 '현재 프롬프트'와 (2) 그 노드가 받은 '격차 서술'
— 이상과 현재의 차이, 그리고 그것이 나온 원인을 선언적으로 기술한 것 —
을 받습니다.

당신의 일은 이 격차를 줄이도록 현재 프롬프트를 다시 쓰는 것입니다.
- 격차 서술은 명령이 아니라 '진단'입니다. 거기서 무엇을 바꿀지는 당신이 추론하세요.
- 최소 편집: 격차와 무관한 부분은 건드리지 마세요.
- 특정 사례의 정답을 외우게 하지 말고, 일반적으로 통하는 방향으로.

출력은 개선된 프롬프트 텍스트만. 다른 설명은 붙이지 마세요.
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
                        notes=SEED_NOTE,
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
                        notes=SEED_NOTE,
                    )
                )
            if "optimizer" not in kinds:
                session.add(
                    Prompt(
                        kind="optimizer",
                        version=1,
                        name="기본 Optimizer v1",
                        template=OPTIMIZER_V1,
                        model=settings.default_model,
                        max_tokens=2000,
                        temperature=0.3,
                        is_active=True,
                        notes=SEED_NOTE,
                    )
                )

            # Keep the pristine seed prompts pointed at the current default
            # model (lets us switch models via DEFAULT_MODEL without DB
            # surgery). Only touches the auto-seeded rows — any version a
            # user created via the UI has different notes and is left alone.
            await session.execute(
                update(Prompt)
                .where(Prompt.notes == SEED_NOTE, Prompt.model != settings.default_model)
                .values(model=settings.default_model)
            )
