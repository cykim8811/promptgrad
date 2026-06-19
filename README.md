# promptgrad

**인간에게 가장 이해가 잘 되는 설명을 하는 시스템**을 찾는 데이터 수집 실험.

두 종류의 "모델"(= 입력→출력 프롬프트)이 있습니다:

- **Generator** — 명세(이해시키고자 하는 대상 지식)를 받아 접근이 서로 다른
  두 설명안 **A / B**를 생성.
- **Evaluator** — A / B를 비교해 사람이 더 쉽게 이해할 쪽을 고르고 이유를 제시.

## 세션 한 번 = 데이터 한 점

1. **명세** + 대상 독자 입력
2. Generator가 A / B 생성 → 토글로 번갈아 열람
3. Evaluator가 더 나은 쪽에 체크 + 간단한 이유
4. 사람이 더 이해가 잘 되는 쪽을 **선택 + 자세한 이유** 작성

수집된 데이터는 (1) Evaluator를 사람 판단에 정렬시키고, 이후 (2) Evaluator의
판단을 Generator로 역전파(back-prop)해 더 본질적인 설명을 만드는 재료가 됩니다.
모델은 버전을 쌓으며 개선하고 세션마다 어떤 버전을 쓸지 고를 수 있습니다.

## 구조

- `frontend/` — Next.js(정적 export) + Tailwind. 세션 플로우 UI.
- `backend/` — FastAPI + Postgres. 세션/후보/평가/피드백/프롬프트 저장,
  관리형 Claude(coders.kr) 호출.
- `coders.yaml` — web / api / postgres / llm 컴포넌트 배포 매니페스트.

LLM은 coders.kr 관리형 Claude를 사용합니다(자체 API 키 없음). 토큰 비용은
각 호출에 `X-Coders-User`를 전달해 방문자 풀로 청구됩니다.

## 로컬 개발

```sh
# backend
cd backend && uv sync --extra dev && uv run uvicorn app.main:app --reload
# frontend
cd frontend && pnpm install && pnpm dev
```

배포는 coders.kr로: `https://promptgrad.coders.kr`.
