"""Optimizer engine — descriptive and human-gated.

A run does ONE pass over the labeled data:

    forward          run the node on each example
    loss (서술)       describe the gap: ideal (= the human's feedback, the
                     only source of "ideal") vs the current output. No number.
    backward (선언)   analyze *why* the node produced this, and state the
                     cause + gap to the node — declaratively, NOT as a command
                     (information transfer, not "do X").
    aggregate        merge the per-example gaps into one root gap for the node.
    optimizer (node) a versioned, improvable prompt that REASONS the gap into
                     a single candidate prompt.

No automatic comparison / validation gate / scalar / best-step / iteration:
the human reads the gaps and the candidate and decides whether to promote.
Every gap a node receives is recorded (run.aggregated_gap), so a node's role
gets sharper over time. We're on the owner's own Anthropic key (coders_user
not needed).
"""

from __future__ import annotations

import asyncio
import hashlib
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core import llm
from app.core.database import AsyncSessionLocal
from app.models import Feedback, OptimizationItem, OptimizationRun, Prompt, Session
from app.routes.sessions import cards_to_text, parse_cards

KIND_LABEL = {"evaluator": "평가자(Evaluator)", "generator": "설명 생성기(Generator)"}


# ---- dataset (no split — comparison is the human's job) ---------------------


def assign_split(session_id: UUID) -> str:
    """Kept for back-compat (feedback/stats). The optimizer ignores splits."""
    h = int(hashlib.sha256(str(session_id).encode()).hexdigest(), 16)
    return "val" if h % 5 == 0 else "train"


async def _load_examples() -> list[dict]:
    async with AsyncSessionLocal() as s:
        res = await s.execute(
            select(Session)
            .options(selectinload(Session.candidates), selectinload(Session.feedback))
            .join(Feedback, Feedback.session_id == Session.id)
        )
        out = []
        for sess in res.scalars().all():
            cand = {c.label: c.content for c in sess.candidates}
            if "A" not in cand or "B" not in cand or sess.feedback is None:
                continue
            rationale = "\n".join(
                t for t in [sess.feedback.reason, sess.feedback.understanding] if t
            )
            a_text = cards_to_text(parse_cards(cand["A"]))
            b_text = cards_to_text(parse_cards(cand["B"]))
            out.append(
                {
                    "session_id": str(sess.id),
                    "spec": sess.spec,
                    "audience": sess.audience,
                    "a_text": a_text,
                    "b_text": b_text,
                    "human_choice": sess.feedback.choice,
                    "human_rationale": rationale,
                    "reference": a_text if sess.feedback.choice == "A" else b_text,
                }
            )
        return out


# ---- forward / loss / backward ---------------------------------------------


async def _forward(kind: str, node_prompt: str, ex: dict, cfg: dict) -> str:
    if kind == "evaluator":
        r = await llm.run_evaluator(
            template=node_prompt, model=cfg["model"],
            max_tokens=cfg.get("eval_max_tokens", 1200),
            temperature=cfg.get("eval_temperature", 0.2),
            spec=ex["spec"], a=ex["a_text"], b=ex["b_text"], coders_user=None,
        )
        return f"선택: {r['winner']}안\n이유: {r['reason']}"
    cards, _raw = await llm.run_generator(
        template=node_prompt, model=cfg["model"],
        max_tokens=cfg.get("gen_max_tokens", 4000),
        temperature=cfg.get("gen_temperature", 1.0),
        spec=ex["spec"], audience=ex["audience"], coders_user=None,
    )
    return cards_to_text(cards)


def _ideal_text(kind: str, ex: dict) -> str:
    rationale = ex["human_rationale"] or "(이유 미기재)"
    if kind == "evaluator":
        return f"사람은 {ex['human_choice']}안을 더 잘 이해했다.\n그 이유: {rationale}"
    return (
        f"사람이 더 잘 이해한 설명(참조):\n{ex['reference']}\n\n그 이유: {rationale}"
    )


async def _loss(kind: str, ex: dict, forward_output: str, cfg: dict) -> str:
    system = (
        "너는 '이상'과 '현재'의 격차를 서술하는 역할이다. 명령하지 마라.\n"
        "이상과 현재가 어디서·어떻게 다른지, 사람이 중시한 바를 기준으로 plain하게 기술하라. "
        "점수·수치를 매기지 말고, 차이를 자연어로만. 차이가 거의 없으면 없다고 적어라."
    )
    user = (
        f"명세: {ex['spec']}\n\n[이상 — 사람의 피드백이 유일한 기준]\n{_ideal_text(kind, ex)}\n\n"
        f"[현재 — 노드의 출력]\n{forward_output}\n\n격차를 서술하라."
    )
    return await llm.complete_text(
        system=system, user=user, model=cfg["judge_model"], temperature=0.2,
        max_tokens=500,
    )


async def _backward(
    kind: str, node_prompt: str, ex: dict, forward_output: str, loss_text: str, cfg: dict
) -> str:
    system = (
        f"너는 {KIND_LABEL[kind]} 노드의 출력에 대한 backward 분석을 한다.\n"
        "'격차 서술'을 보고 (1) 이 노드가 *왜* 그런 출력을 냈는지(현재 프롬프트의 어떤 측면 "
        "때문인지) 원인을 추정하고 (2) 이상과의 격차를 그 원인과 함께 선언적으로 서술하라.\n"
        "규칙: '~하라/추가하라' 같은 명령 금지 — 이건 노드에게 전달되는 *정보*이지 지시가 아니다. "
        "원인 추정은 틀릴 수 있으니 단정보다 관찰된 근거에 기반해 기술하라."
    )
    user = (
        f"노드의 현재 프롬프트:\n\"\"\"\n{node_prompt}\n\"\"\"\n\n"
        f"사례(명세): {ex['spec']}\n\n[노드 출력]\n{forward_output}\n\n[격차 서술]\n{loss_text}\n\n"
        "이 노드에 대한 backward(원인 + 격차, 선언형)를 적어라."
    )
    return await llm.complete_text(
        system=system, user=user, model=cfg["judge_model"], temperature=0.2,
        max_tokens=600,
    )


async def _aggregate(kind: str, backwards: list[str], cfg: dict) -> str:
    joined = "\n\n---\n".join(f"[사례 {i + 1}]\n{b}" for i, b in enumerate(backwards))
    system = (
        f"너는 {KIND_LABEL[kind]} 노드가 여러 사례에서 받은 backward(격차) 서술들을 통합한다.\n"
        "반복적으로 나타나는 *근본 격차*를 하나의 선언적 서술로 합쳐라. 명령 금지, 정보 전달만. "
        "이 노드가 본래 어떤 역할을 해야 하는지가 드러나도록."
    )
    user = f"개별 backward 서술들:\n{joined}\n\n통합된 근본 격차를 서술하라."
    return await llm.complete_text(
        system=system, user=user, model=cfg["judge_model"], temperature=0.2,
        max_tokens=700,
    )


async def _optimize_prompt(
    optimizer_template: str, node_prompt: str, aggregated_gap: str, cfg: dict
) -> str:
    user = (
        f"[현재 프롬프트]\n\"\"\"\n{node_prompt}\n\"\"\"\n\n"
        f"[격차 서술 — 진단]\n{aggregated_gap}\n\n개선된 프롬프트:"
    )
    out = await llm.complete_text(
        system=optimizer_template, user=user, model=cfg["judge_model"],
        temperature=0.2, max_tokens=1400,
    )
    return out.strip().strip('"')


# ---- the run ---------------------------------------------------------------


async def run_optimization(run_id: UUID) -> None:
    examples = await _load_examples()

    async with AsyncSessionLocal() as s:
        async with s.begin():
            run = await s.get(OptimizationRun, run_id)
            base = await s.get(Prompt, run.base_prompt_id)
            cfg = dict(run.config)
            kind = run.target_kind
            node_prompt = base.template
            run.train_count = len(examples)
            opt_id = run.optimizer_prompt_id
            if not examples:
                run.status = "error"
                run.error = "라벨된 데이터가 없습니다 (세션에 피드백을 먼저 남기세요)."
                return
            opt = await s.get(Prompt, opt_id) if opt_id else None
            if opt is None:
                run.status = "error"
                run.error = "활성 Optimizer가 없습니다."
                return
            opt_template = opt.template

    try:
        async def process(ex):
            fwd = await _forward(kind, node_prompt, ex, cfg)
            loss = await _loss(kind, ex, fwd, cfg)
            back = await _backward(kind, node_prompt, ex, fwd, loss, cfg)
            return ex, fwd, loss, back

        results = await asyncio.gather(*[process(e) for e in examples])

        async with AsyncSessionLocal() as s:
            async with s.begin():
                for ex, fwd, loss, back in results:
                    s.add(
                        OptimizationItem(
                            run_id=run_id,
                            session_id=UUID(ex["session_id"]),
                            spec=ex["spec"][:300],
                            forward_output=fwd,
                            loss_text=loss,
                            backward_text=back,
                        )
                    )

        agg = await _aggregate(kind, [r[3] for r in results], cfg)
        candidate = await _optimize_prompt(opt_template, node_prompt, agg, cfg)

        async with AsyncSessionLocal() as s:
            async with s.begin():
                run = await s.get(OptimizationRun, run_id)
                run.aggregated_gap = agg
                run.candidate_prompt = candidate
                run.status = "awaiting_review"
    except Exception as e:  # noqa: BLE001
        async with AsyncSessionLocal() as s:
            async with s.begin():
                run = await s.get(OptimizationRun, run_id)
                run.status = "error"
                run.error = f"optimization failed: {e}"
