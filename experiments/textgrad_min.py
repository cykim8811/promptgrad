#!/usr/bin/env python3
"""Task A — minimal single-node textual-gradient experiment.

One trainable node: the explainer's *system prompt*. We run
forward -> programmatic loss -> textual gradient -> optimizer.step(),
looped, and watch whether the prompt moves in the desired direction.

Design choices that make this a *mechanism* test (not a labeling test):
  - loss is 100% programmatic (count of violated rules), so "the desired
    direction" is unambiguous and cheap.
  - the gradient is defined to carry DIRECTION + WHICH RULE failed
    (a minimal "semantic gradient"), not a vague "make it better".
  - the optimizer applies it with minimal edits and a length cap
    (length regularization — our differentiator from the literature).

No third-party deps. Reads ANTHROPIC_API_KEY (and optional MODEL) from env.
"""

import json
import os
import re
import sys
import urllib.request

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
MODEL = os.environ.get("MODEL", "claude-haiku-4-5")
N_ITERS = 4

CONCEPTS = ["재귀", "복리", "무지개", "광합성", "베이즈 정리"]

# Deliberately deficient seed: enforces none of the three rules.
SEED_PROMPT = "주어진 개념을 설명하라."

# ---- loss: three programmatic rules (lower is better, 0..3) ----------------

ANALOGY = re.compile(r"처럼|마치|비유하자면|같이|같은")
MAX_WORDS = 60


def _nonempty_lines(text):
    return [ln for ln in text.strip().splitlines() if ln.strip()]


def violated_rules(text):
    fails = []
    if len(text.split()) > MAX_WORDS:
        fails.append(f"{MAX_WORDS}단어 초과")
    if not ANALOGY.search(text):
        fails.append("비유 표현 없음")
    lines = _nonempty_lines(text)
    if not lines or not lines[-1].strip().startswith("요약:"):
        fails.append("'요약:' 줄로 끝나지 않음")
    return fails


# ---- LLM call (stdlib only) ------------------------------------------------


def llm(system, user, max_tokens=700, temperature=0.4):
    body = json.dumps(
        {
            "model": MODEL,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read())
    return "".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    ).strip()


# ---- forward + loss over the minibatch -------------------------------------


def forward(prompt, concept):
    return llm(system=prompt, user=f"개념: {concept}", temperature=0.4)


def measure_loss(prompt):
    records, total = [], 0
    for c in CONCEPTS:
        out = forward(prompt, c)
        fails = violated_rules(out)
        total += len(fails)
        records.append((c, out, fails))
    return total / len(CONCEPTS), records


# ---- backward: the textual gradient ----------------------------------------


def gradient(prompt, records):
    evidence = "\n".join(
        f"- '{c}': 위반 {fails if fails else '없음'}" for c, _out, fails in records
    )
    system = (
        "너는 어떤 프롬프트에 대한 'gradient'를 계산하는 연산자다.\n"
        "loss = 아래 3개 규칙의 위반 개수(낮을수록 좋음).\n"
        "  R1) 출력이 60단어 이하\n"
        "  R2) 비유 표현(처럼/마치/비유하자면 등) 포함\n"
        "  R3) 마지막 줄이 '요약:'으로 시작\n"
        "gradient는 다음만 담아라: (a) 현재 프롬프트가 *강제하지 못해* 위반된 규칙이 무엇인지 특정, "
        "(b) 그 규칙을 만족시키려면 프롬프트가 추가로 무엇을 지시해야 하는지 '방향'. "
        "실제로 위반된 규칙만, 최소한으로. 새 프롬프트를 작성하지 말고 비평(gradient)만 출력하라."
    )
    user = (
        f"현재 프롬프트:\n\"\"\"\n{prompt}\n\"\"\"\n\n"
        f"관측(개념별 규칙 위반):\n{evidence}\n\n"
        "이 프롬프트의 gradient를 적어라."
    )
    return llm(system, user, temperature=0.2)


# ---- optimizer.step(): textual gradient descent ----------------------------


def step(prompt, grad):
    system = (
        "너는 textual gradient descent 옵티마이저다. 현재 프롬프트에 gradient(비평)를 "
        "반영해 개선된 프롬프트를 출력하라.\n"
        "제약: (1) 최소 편집 — gradient가 지적한 부분만 고친다(learning rate 작게). "
        "(2) 길이 정칙화 — 프롬프트는 3문장 이내로 짧고 일반적으로 유지(특정 개념에 종속 금지). "
        "출력은 개선된 프롬프트 텍스트만."
    )
    user = f"현재 프롬프트:\n\"\"\"\n{prompt}\n\"\"\"\n\ngradient:\n{grad}\n\n개선된 프롬프트:"
    return llm(system, user, temperature=0.2).strip().strip('"')


# ---- training loop ---------------------------------------------------------


def main():
    if not API_KEY:
        sys.exit("ANTHROPIC_API_KEY 가 환경에 없습니다.")
    print(f"model={MODEL}  concepts={CONCEPTS}\n" + "=" * 70)
    prompt = SEED_PROMPT
    curve = []
    for it in range(N_ITERS + 1):
        loss, records = measure_loss(prompt)
        curve.append(loss)
        print(f"\n[iter {it}] loss={loss:.2f}  prompt= {prompt!r}")
        for c, _out, fails in records:
            print(f"    {c:6} 위반: {fails if fails else '없음 ✓'}")
        if loss == 0 or it == N_ITERS:
            break
        grad = gradient(prompt, records)
        print("\n  ── gradient ∂loss/∂prompt ──")
        print("  " + grad.replace("\n", "\n  "))
        prompt = step(prompt, grad)

    print("\n" + "=" * 70)
    print("loss curve:", " → ".join(f"{x:.2f}" for x in curve))
    print("final prompt:", repr(prompt))


if __name__ == "__main__":
    main()
