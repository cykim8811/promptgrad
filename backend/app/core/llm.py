"""Thin wrapper over the platform's managed Claude endpoint.

The coders.kr platform injects ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY
(see coders.yaml + PLATFORM.md §8). The stock Anthropic SDK reads those
from env, so `AsyncAnthropic()` Just Works. We MUST forward the visitor's
identity as `x-coders-user` on every call so the token cost lands on
their pool rather than the project's anonymous pool.
"""

from __future__ import annotations

import json
from uuid import UUID

from anthropic import AsyncAnthropic

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    # Lazy so a missing key only errors on first call, not at import.
    # base_url + api_key come from env (ANTHROPIC_BASE_URL / _API_KEY),
    # injected by the platform — see coders.yaml.
    global _client
    if _client is None:
        _client = AsyncAnthropic()
    return _client


def _extra_headers(coders_user: UUID | None) -> dict[str, str]:
    return {"x-coders-user": str(coders_user)} if coders_user else {}


def _extract_json(text: str) -> dict:
    """Best-effort JSON object extraction from a model response."""
    text = text.strip()
    if text.startswith("```"):
        # strip a ```json ... ``` fence
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


async def _complete_json(
    *,
    model: str,
    max_tokens: int,
    temperature: float,
    system: str,
    user: str,
    coders_user: UUID | None,
) -> tuple[dict, str]:
    """Run a single turn, prefilled with '{' to force a JSON object."""
    msg = await _get_client().messages.create(
        model=model,
        max_tokens=min(max_tokens, 16000),
        temperature=temperature,
        system=system,
        messages=[
            {"role": "user", "content": user},
            {"role": "assistant", "content": "{"},
        ],
        extra_headers=_extra_headers(coders_user),
    )
    raw = "{" + "".join(
        block.text for block in msg.content if block.type == "text"
    )
    return _extract_json(raw), raw


async def run_generator(
    *,
    template: str,
    model: str,
    max_tokens: int,
    temperature: float,
    spec: str,
    audience: str,
    coders_user: UUID | None,
) -> tuple[str, str, str]:
    """Return (candidate_a, candidate_b, raw_json)."""
    system = template.format(spec=spec, audience=audience or "(특별히 지정되지 않음)")
    user = (
        "위 지시에 따라 두 가지 설명안을 작성하세요.\n"
        "반드시 다음 형식의 JSON 객체로만 응답하세요. 다른 텍스트는 출력하지 마세요:\n"
        '{"a": "설명안 A 전체 (마크다운 허용)", "b": "설명안 B 전체 (마크다운 허용)"}'
    )
    data, raw = await _complete_json(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        user=user,
        coders_user=coders_user,
    )
    return str(data.get("a", "")).strip(), str(data.get("b", "")).strip(), raw


async def run_evaluator(
    *,
    template: str,
    model: str,
    max_tokens: int,
    temperature: float,
    spec: str,
    a: str,
    b: str,
    coders_user: UUID | None,
) -> dict:
    """Return {winner, reason, critique_a, critique_b, raw}."""
    system = template.format(spec=spec, a=a, b=b)
    user = (
        f"## 명세\n{spec}\n\n## 설명안 A\n{a}\n\n## 설명안 B\n{b}\n\n"
        "위 지시에 따라 평가하세요. 반드시 다음 형식의 JSON 객체로만 응답하세요:\n"
        '{"winner": "A" 또는 "B", "reason": "왜 그쪽이 더 이해하기 쉬운지 간단히", '
        '"critique_a": "A에 대한 짧은 평", "critique_b": "B에 대한 짧은 평"}'
    )
    data, raw = await _complete_json(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        user=user,
        coders_user=coders_user,
    )
    winner = str(data.get("winner", "")).strip().upper()
    if winner not in ("A", "B"):
        winner = "A"
    return {
        "winner": winner,
        "reason": str(data.get("reason", "")).strip(),
        "critique_a": str(data.get("critique_a", "")).strip(),
        "critique_b": str(data.get("critique_b", "")).strip(),
        "raw": raw,
    }
