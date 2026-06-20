"""Optimizer engine — textual-gradient optimization of a single prompt node.

forward -> semantic loss -> textual gradient -> step, looped, with a
held-out validation gate. Persists every step so the UI can poll.

We're on the owner's own Anthropic key now, so no x-coders-user billing
forwarding is needed (coders_user=None everywhere).
"""

from __future__ import annotations

import asyncio
import hashlib
import random
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core import llm
from app.core.database import AsyncSessionLocal
from app.models import Feedback, OptimizationRun, OptimizationStep, Prompt, Session
from app.routes.sessions import cards_to_text, parse_cards

# ---- dataset split ---------------------------------------------------------


def assign_split(session_id: UUID) -> str:
    """Deterministic 80/20 train/val from the session id (reproducible)."""
    h = int(hashlib.sha256(str(session_id).encode()).hexdigest(), 16)
    return "val" if h % 5 == 0 else "train"


async def ensure_splits() -> None:
    """Backfill a split for any labeled session that still has 'none'."""
    async with AsyncSessionLocal() as s:
        async with s.begin():
            res = await s.execute(
                select(Session)
                .join(Feedback, Feedback.session_id == Session.id)
                .where(Session.split == "none")
            )
            for sess in res.scalars().all():
                sess.split = assign_split(sess.id)


async def _load_examples(split: str) -> list[dict]:
    async with AsyncSessionLocal() as s:
        res = await s.execute(
            select(Session)
            .options(
                selectinload(Session.candidates),
                selectinload(Session.feedback),
            )
            .join(Feedback, Feedback.session_id == Session.id)
            .where(Session.split == split)
        )
        out = []
        for sess in res.scalars().all():
            cand = {c.label: c.content for c in sess.candidates}
            if "A" not in cand or "B" not in cand or sess.feedback is None:
                continue
            rationale = "\n".join(
                t for t in [sess.feedback.reason, sess.feedback.understanding] if t
            )
            out.append(
                {
                    "session_id": str(sess.id),
                    "spec": sess.spec,
                    "a_text": cards_to_text(parse_cards(cand["A"])),
                    "b_text": cards_to_text(parse_cards(cand["B"])),
                    "human_choice": sess.feedback.choice,
                    "human_rationale": rationale,
                }
            )
        return out


# ---- loss: rationale recovery (Evaluator node) -----------------------------


async def _judge_coverage(human_rationale: str, eval_reason: str, model: str) -> float:
    if not human_rationale.strip():
        return 1.0  # nothing to recover -> don't penalize
    system = (
        "너는 평가자(Evaluator)의 추론이 '사람이 적은 이유'의 핵심 논점을 "
        "얼마나 회복하는지 채점한다. 표현이 아니라 내용으로 판단하라.\n"
        '반드시 JSON으로만: {"coverage": 0~1 사이 수} '
        "(1=사람의 핵심 논점을 충실히 담음, 0=전혀 못 담음)."
    )
    user = (
        f"사람의 이유:\n{human_rationale}\n\n"
        f"Evaluator의 이유:\n{eval_reason}\n\ncoverage를 JSON으로 출력."
    )
    try:
        data = await llm.complete_json(system=system, user=user, model=model)
        return max(0.0, min(1.0, float(data.get("coverage", 0))))
    except Exception:
        return 0.0


async def _eval_example(prompt: str, ex: dict, cfg: dict) -> tuple[float, dict]:
    model = cfg["model"]
    result = await llm.run_evaluator(
        template=prompt,
        model=model,
        max_tokens=cfg.get("eval_max_tokens", 1200),
        temperature=cfg.get("eval_temperature", 0.2),
        spec=ex["spec"],
        a=ex["a_text"],
        b=ex["b_text"],
        coders_user=None,
    )
    winner = result["winner"]
    reason = result["reason"]
    choice_match = 1.0 if winner == ex["human_choice"] else 0.0
    coverage = await _judge_coverage(ex["human_rationale"], reason, cfg["judge_model"])
    w_choice = cfg.get("w_choice", 0.4)
    w_cov = cfg.get("w_cov", 0.6)
    loss = w_choice * (1 - choice_match) + w_cov * (1 - coverage)
    record = {
        "session_id": ex["session_id"],
        "spec": ex["spec"][:240],
        "human_choice": ex["human_choice"],
        "human_rationale": ex["human_rationale"][:800],
        "eval_winner": winner,
        "eval_reason": reason[:800],
        "choice_match": choice_match,
        "coverage": round(coverage, 2),
        "loss": round(loss, 3),
    }
    return loss, record


async def _set_loss(prompt: str, exs: list[dict], cfg: dict) -> tuple[float, list[dict]]:
    if not exs:
        return 0.0, []
    results = await asyncio.gather(*[_eval_example(prompt, e, cfg) for e in exs])
    mean = sum(r[0] for r in results) / len(results)
    return mean, [r[1] for r in results]


# ---- gradient + step -------------------------------------------------------


async def _textual_gradient(prompt: str, records: list[dict], cfg: dict) -> str:
    evidence = "\n".join(
        f"- 명세 '{r['spec'][:40]}…': 사람={r['human_choice']}안(이유: {r['human_rationale'][:120]}) / "
        f"Evaluator={r['eval_winner']}안(이유: {r['eval_reason'][:120]}) "
        f"[일치={int(r['choice_match'])}, 이유회복={r['coverage']}]"
        for r in records
    )
    system = (
        "너는 어떤 Evaluator 프롬프트에 대한 'gradient'를 계산한다.\n"
        "loss = (사람의 선택과 불일치) + (사람이 적은 '이유'를 Evaluator가 회복하지 못함). "
        "후자에 더 큰 가중치.\n"
        "gradient는 다음만 담아라: (a) 사람들이 *실제로 사용한 판단 기준* 중 현재 프롬프트가 "
        "인코딩하지 못한 것을 특정, (b) 그 기준을 담으려면 프롬프트가 무엇을 추가로 지시해야 하는지 "
        "'방향'. 실제 관측된 실패에만 근거하고 최소한으로. 새 프롬프트를 쓰지 말고 비평(gradient)만."
    )
    user = (
        f"현재 Evaluator 프롬프트:\n\"\"\"\n{prompt}\n\"\"\"\n\n"
        f"관측(라벨 vs Evaluator):\n{evidence}\n\n이 프롬프트의 gradient를 적어라."
    )
    return await llm.complete_text(
        system=system, user=user, model=cfg["judge_model"], temperature=0.2,
        max_tokens=700,
    )


async def _step(prompt: str, grad: str, cfg: dict) -> str:
    cap = cfg.get("length_cap", 600)
    system = (
        "너는 textual gradient descent 옵티마이저다. 현재 Evaluator 프롬프트에 "
        "gradient(비평)를 반영해 개선된 프롬프트를 출력하라.\n"
        f"제약: (1) 최소 편집 — gradient가 지적한 부분만. (2) 길이 정칙화 — {cap}자 이내로 "
        "짧고 일반적으로 유지(특정 사례에 종속 금지). 출력은 개선된 프롬프트 텍스트만."
    )
    user = (
        f"현재 프롬프트:\n\"\"\"\n{prompt}\n\"\"\"\n\ngradient:\n{grad}\n\n개선된 프롬프트:"
    )
    out = await llm.complete_text(
        system=system, user=user, model=cfg["judge_model"], temperature=0.2,
        max_tokens=900,
    )
    return out.strip().strip('"')[: cap * 2]  # hard safety cap


# ---- the run ---------------------------------------------------------------


async def run_optimization(run_id: UUID) -> None:
    await ensure_splits()
    train = await _load_examples("train")
    val = await _load_examples("val")

    async with AsyncSessionLocal() as s:
        async with s.begin():
            run = await s.get(OptimizationRun, run_id)
            base = await s.get(Prompt, run.base_prompt_id)
            cfg = dict(run.config)
            base_text = base.template
            run.train_count = len(train)
            run.val_count = len(val)
            if not train:
                run.status = "error"
                run.error = "라벨된 학습 데이터가 없습니다 (세션에 피드백을 먼저 남기세요)."
                return

    try:
        base_val = (await _set_loss(base_text, val, cfg))[0] if val else None
        async with AsyncSessionLocal() as s:
            async with s.begin():
                run = await s.get(OptimizationRun, run_id)
                run.base_val_score = base_val

        prompt = base_text
        best_val = base_val if base_val is not None else float("inf")
        best_idx: int | None = None
        n_iters = cfg.get("n_iters", 3)
        batch_size = cfg.get("batch_size", 4)
        stop = cfg.get("stop", 0.05)

        for i in range(n_iters):
            rng = random.Random(f"{run_id}:{i}")
            batch = train if len(train) <= batch_size else rng.sample(train, batch_size)
            train_loss, records = await _set_loss(prompt, batch, cfg)

            grad, candidate, val_score, accepted = "", "", None, False
            if train_loss > stop:
                grad = await _textual_gradient(prompt, records, cfg)
                candidate = await _step(prompt, grad, cfg)
                val_score = (await _set_loss(candidate, val, cfg))[0] if val else None
                accepted = (
                    (val_score is not None and val_score < best_val)
                    or (val_score is None)
                )

            async with AsyncSessionLocal() as s:
                async with s.begin():
                    s.add(
                        OptimizationStep(
                            run_id=run_id,
                            idx=i,
                            train_loss=train_loss,
                            val_score=val_score,
                            gradient_text=grad,
                            candidate_prompt=candidate,
                            accepted=accepted,
                            records=records,
                        )
                    )

            if accepted and candidate:
                prompt = candidate
                best_idx = i
                if val_score is not None:
                    best_val = val_score
            if train_loss <= stop:
                break

        async with AsyncSessionLocal() as s:
            async with s.begin():
                run = await s.get(OptimizationRun, run_id)
                run.best_step_idx = best_idx
                run.status = "awaiting_review"
    except Exception as e:  # noqa: BLE001
        async with AsyncSessionLocal() as s:
            async with s.begin():
                run = await s.get(OptimizationRun, run_id)
                run.status = "error"
                run.error = f"optimization failed: {e}"
