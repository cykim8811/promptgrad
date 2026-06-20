# promptgrad — Optimizer 서브시스템 설계

> 목표: Task A 스크립트(forward→loss→textual gradient→step)를 **사이트에 통합된,
> 안정적·체계적·확장 가능한 1급 시스템**으로 승격한다. 첫 적용은 **Task C
> = Evaluator를 "사람의 자유서술 이유"에 정렬**(의미적 loss). 이후 Generator,
> 그리고 다노드(many-to-many) 그래프로 같은 엔진을 확장한다.

## 0. 설계 원칙 (이게 "안정/체계/확장"을 보장)

- **P1 모든 것이 버전·재현 가능** — 모든 최적화 실행은 base 프롬프트 버전, 데이터
  split, config를 고정 기록한다(autograd의 "tape"에 해당).
- **P2 사람 승인 게이트 (조용한 drift 금지)** — 최적화는 *후보* 프롬프트를 만들 뿐,
  활성 버전 교체는 사람이 명시적으로 승격할 때만.
- **P3 loss는 플러그형** — `LossFn` 인터페이스. Task A의 규칙 loss, Task C의
  이유-회복 loss가 같은 인터페이스의 구현체. 노드별로 다른 loss 사용 가능.
- **P4 held-out 검증 게이트** — 모든 후보는 보류 split에서 점수가 좋아질 때만 채택.
  (과적합·발산 방지의 핵심)
- **P5 길이/MDL 정칙화 내장** — step에 길이 상한·최소 편집. 일반해로 수렴.
- **P6 노드 비종속** — 엔진은 "임의의 Prompt + forward fn + loss"에 작동. Evaluator
  → Generator → 다노드로 코드 재사용.

## 1. 핵심 추상 (autograd 객체 = 1급 DB 엔티티)

기존 자산: `Prompt`(버전형 노드), `Session`+`Feedback`(라벨 데이터), `Candidate`,
`Evaluation`. 여기에 다음을 추가한다.

### 1.1 데이터셋 / split
라벨 예시 = 사람 피드백이 있는 세션 `{spec, A, B, choice, rationale}`.
- `Session`에 `split: 'train' | 'val' | 'none'` 컬럼 추가(기본 none).
- 라벨(피드백) 생성 시 결정적 해시(session_id)로 train/val 배정(예: 80/20). 재현성
  위해 난수 대신 해시 기반.
- 보류(val) split은 P4 검증 게이트 전용. 절대 gradient 계산에 쓰지 않음.

### 1.2 `OptimizationRun` (신규)
한 노드에 대한 1회 최적화.
| 필드 | 의미 |
|---|---|
| id | |
| target_kind | `evaluator` \| `generator` (이후 `graph`) |
| base_prompt_id | 시작 프롬프트 버전 (FK Prompt) |
| loss_type | `rationale_recovery` \| `understandability` \| `rule` … |
| config (json) | n_iters, batch_size, length_cap, beam_width, weights(w_choice,w_cov), model |
| status | `running` \| `awaiting_review` \| `promoted` \| `discarded` \| `error` |
| best_step_id | 최종 후보를 만든 step |
| produced_prompt_id | 승격 시 생성된 Prompt 버전 (FK, nullable) |
| created_by, created_at | |

### 1.3 `OptimizationStep` (신규) — "training tape"
실행의 매 반복 1행.
| 필드 | 의미 |
|---|---|
| id, run_id, idx | |
| batch_session_ids (json) | 이 스텝의 미니배치 |
| train_loss | 미니배치 loss |
| records (json) | 개념별 forward 출력 + 채점 근거 (gradient 입력) |
| gradient_text | 자연어 textual gradient (의미적 정의: 방향+어디가·왜) |
| candidate_prompt | step()이 만든 후보 프롬프트 텍스트 |
| val_score | held-out 검증 점수 (P4 게이트) |
| accepted | 검증 통과로 채택됐는지 |

승격(promote) = `best_step.candidate_prompt`로 **정상 `Prompt` 새 버전 생성**
(기존 버전 시스템에 그대로 편입) + run.produced_prompt_id 링크.

## 2. Task C의 loss (의미적) — `LossFn` 인터페이스

```
LossFn(prompt, example) -> (loss: float in [0,1], record: dict)
```

### 2.1 Evaluator: `rationale_recovery` (1차 목표)
입력 예시 = `{spec, A, B, human_choice, human_rationale}`.
1. 후보 Evaluator 프롬프트로 forward → `(winner, reason)`.
2. loss 두 성분:
   - **choice_match**: `winner == human_choice` (0/1)
   - **rationale_coverage**: LLM-judge가 채점 — "Evaluator의 reason이 사람의
     rationale 핵심 논점을 얼마나 회복했는가" (0..1)
3. `loss = w_choice·(1 − choice_match) + w_cov·(1 − coverage)` (기본 w_choice=0.4,
   w_cov=0.6 — *이유 회복을 일치보다 무겁게*, 사용자 요구 반영).

> 잡음 대비: 미니배치 평균 + P4 held-out 검증 + judge 원출력 저장(감사). 단일
> 예시를 신뢰하지 않는다.

### 2.2 Generator: `understandability` (2차, Evaluator 신뢰 후)
이긴/진 설명 + 사람 rationale → "무엇이 더 이해되게 했나"를 (신뢰된) Evaluator가
채점. **gradient는 spec(형제 노드)에 조건화**(semantic-backprop 교훈).

## 3. 최적화 루프 (엔진)

```python
def optimize(run):
    prompt = base_prompt.text
    best = (None, +inf)
    for i in range(cfg.n_iters):
        batch   = sample(train_split, cfg.batch_size)        # 결정적 시드
        loss, records = mean(loss_fn(prompt, ex) for ex in batch)   # forward+채점
        if loss <= cfg.stop or over_length_budget(prompt):   # 조기종료=정칙화
            break
        grad      = textual_gradient(prompt, records)         # 의미적 gradient
        candidate = step(prompt, grad, length_cap=cfg.length_cap)  # 최소편집+길이
        val       = mean(loss_fn(candidate, val_split))       # P4 held-out 게이트
        accepted  = val < best[1]                             # 좋아질 때만 채택
        log_step(run, i, batch, loss, records, grad, candidate, val, accepted)
        if accepted:
            prompt, best = candidate, (candidate, val)
        # (beam_width>1이면 후보 K개 생성→상위 유지)
    run.best_step = argmin_val(steps); run.status = "awaiting_review"
```

안정성 장치 = **held-out 채택 게이트 · beam/keep-best · 조기종료 · 미니배치 평균 ·
길이 상한**. 비동기 백그라운드 실행(다수 LLM 호출). UI는 폴링.

## 4. API

```
POST /api/optimize                 # 실행 시작 {target_kind, base_prompt_id, loss_type, config}
GET  /api/optimize                 # 실행 목록
GET  /api/optimize/{id}            # 상태 + steps(loss 곡선, gradient, 후보)
POST /api/optimize/{id}/promote    # 후보 → 새 Prompt 버전(+옵션 activate)
POST /api/optimize/{id}/discard
GET  /api/dataset/stats            # 라벨 수, train/val, 불일치 수
```
모두 쓰기는 require_identity(소유자). 시작 전 토큰/호출 수 추정 표시.

## 5. UI (사이트) — "학습" 섹션 신설

- **실행 만들기**: 대상(Evaluator/Generator) + base 버전 + config(n_iters, length_cap,
  loss_type, weights). 예상 비용 표시 → 시작.
- **라이브 뷰**(= 우리가 만든 HTML 리포트의 실시간판):
  - **loss 곡선**(train + val), 스텝별 **gradient 원문**, 후보 프롬프트 **diff vs base**.
  - 채택/기각 pill, val 게이트 표시.
- **검토 게이트**: base ↔ 후보 나란히 + held-out 점수 → **[승격(새 버전)] / [폐기]**.
- **데이터셋 뷰**: 라벨 세션, train/val split, 불일치 수.

## 6. 다노드 확장 경로 (엔드게임 미리 대비)

- 엔진이 노드 비종속(P6)이라 **Generator 추가 = target_kind 하나 추가**.
- 이후 `Graph` 추상: 노드(Prompt들)+엣지+그래프 forward+**textual backprop 합성**
  (형제·spec 조건화 = semantic backprop). `OptimizationRun.target_kind='graph'`로
  여러 노드를 동시에 최적화. **지금 스키마를 이를 받게 설계**(run이 ≥1 노드 타깃,
  step이 노드별 gradient 저장 가능)하되 v1은 단일 노드.
- 연구 확장: gradient에 **magnitude**, **반사실(섭동→loss)** 영향력, **정보이득 loss**.

## 7. 운영/안정성

- **재현성**: run이 base 버전·split(시드/ids)·config 고정. step이 전 과정 저장(tape).
- **비용통제**: 시작 전 추정, n_iters·batch 상한, 소유자 게이트.
- **drift 금지**: 승격은 항상 사람 게이트. 활성 버전은 명시적 promote+activate에서만 변경.
- **버전 연속성**: 승격 후보 = 정상 Prompt 버전(기존 시스템 그대로). run↔version 링크.
- **loss 잡음**: 검증 게이트 + 평균 + judge 원출력 저장(감사).

## 8. 단계별 롤아웃

- **Phase 0** — 스키마(OptimizationRun/Step, Session.split) + `LossFn` 인터페이스 + 데이터셋 split.
- **Phase 1 (= Task C in site)** — Evaluator 옵티마이저(rationale_recovery) end-to-end
  + 학습 UI(실행·loss곡선·gradient·검토·승격). **여기까지가 이번 목표.**
- **Phase 2** — Generator 옵티마이저(Evaluator 매개 loss, spec 조건화).
- **Phase 3** — Graph 추상 + 다노드 credit assignment(semantic backprop).
- **Phase 4** — 연구 확장(magnitude / 반사실 / 정보이득).

## 9. 전제 / 선행 조건

- Task C는 **라벨된 세션이 train/val로 나눠 최소 몇 개** 필요. 현재 라벨이 적으면
  먼저 몇 개 더 라벨링(또는 Phase 1을 작은 데이터로 "스모크"부터). 데이터 부족 시
  엔진은 동작하되 검증 신뢰도가 낮음을 UI에 표시.
- judge 모델: 기본 haiku로 시작, 필요 시 sonnet으로 승급(loss_type별 모델 분리 가능).
