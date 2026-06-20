"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInLink } from "@/components/SignIn";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/identity";
import {
  discardRun,
  fetchDatasetStats,
  fetchPrompts,
  fetchRun,
  fetchRuns,
  promoteRun,
  startOptimize,
  type DatasetStats,
  type OptRun,
  type Prompt,
} from "@/lib/api";

export default function OptimizePage() {
  const me = useMe();
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [runs, setRuns] = useState<OptRun[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function reloadRuns() {
    fetchRuns().then(setRuns).catch(() => setRuns([]));
  }
  useEffect(() => {
    fetchDatasetStats().then(setStats).catch(() => {});
    reloadRuns();
  }, []);

  return (
    <div className="space-y-8 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">학습 (Optimizer)</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          한 번의 실행 = <b className="text-foreground">forward → 격차 서술(loss) →
          원인 분석(backward) → 통합 → optimizer가 새 프롬프트 제안</b>. loss는
          수치가 아니라 <b className="text-foreground">이상(=당신의 피드백)과 현재의
          차이를 풀어 쓴 서술</b>이고, 자동 채점·게이트는 없습니다 — 당신이 격차와
          후보를 읽고 승격을 판단합니다.
        </p>
      </header>

      <DatasetBar stats={stats} />

      {me === undefined ? null : me ? (
        <NewRun
          onStarted={(r) => {
            reloadRuns();
            setSelected(r.id);
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
          <p className="text-[14px] text-muted-foreground">학습을 실행하려면 로그인하세요.</p>
          <SignInLink />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          실행 기록 (노드가 받아온 격차들)
        </h2>
        {runs === null && <Skeleton className="h-16 w-full" />}
        {runs && runs.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/40 px-5 py-6 text-center text-[13px] text-muted-foreground">
            아직 실행이 없습니다.
          </p>
        )}
        <ul className="space-y-1">
          {runs?.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(selected === r.id ? null : r.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                  selected === r.id && "bg-muted/50"
                )}
              >
                <span className="text-[13px]">
                  <span className="font-medium capitalize">{r.target_kind}</span>
                  <span className="text-muted-foreground">
                    {" "}· 예시 {r.example_count}
                    {r.created_at
                      ? ` · ${new Date(r.created_at).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <RunStatus status={r.status} />
              </button>
              {selected === r.id && (
                <RunDetail runId={r.id} canEdit={!!me} onChanged={reloadRuns} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DatasetBar({ stats }: { stats: DatasetStats | null }) {
  const items = [
    ["라벨", stats?.labeled],
    ["이유 작성됨", stats?.with_reason],
    ["Evaluator 불일치", stats?.disagreements],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([l, v]) => (
        <div key={l} className="rounded-lg border bg-card px-3 py-2.5 text-center">
          <div className="text-xl font-semibold tabular-nums">{v ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">{l}</div>
        </div>
      ))}
    </div>
  );
}

function NewRun({ onStarted }: { onStarted: (r: OptRun) => void }) {
  const [target, setTarget] = useState<"evaluator" | "generator">("evaluator");
  const [prompts, setPrompts] = useState<Record<string, Prompt[]> | null>(null);
  const [baseId, setBaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchPrompts().then(setPrompts).catch(() => {});
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await startOptimize({
        target_kind: target,
        base_prompt_id: baseId || undefined,
      });
      onStarted(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-medium">새 학습 실행</h2>
        <div className="inline-flex rounded-lg border p-0.5">
          {(["evaluator", "generator"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTarget(t);
                setBaseId("");
              }}
              className={cn(
                "rounded-md px-3 py-1 text-[12px] font-medium capitalize transition-colors",
                target === t
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {target === "evaluator"
          ? "이상 = 사람의 선택 + 이유. 평가자 출력이 그것과 어떻게 다른지를 서술합니다."
          : "이상 = 사람이 더 잘 이해한 설명(참조) + 이유. 새 생성이 그것과 어떻게 다른지를 서술합니다."}
        {" "}활성 Optimizer 노드가 격차를 새 프롬프트로 추론합니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`base ${target} 버전`}>
          <select
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            className="block w-full rounded-md border bg-background px-3 py-2 text-[13px] focus:border-foreground/40 focus:outline-none"
          >
            <option value="">활성 버전 (기본)</option>
            {(prompts?.[target] ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                v{p.version} · {p.name}
                {p.is_active ? " · 활성" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Optimizer 노드">
          <select
            disabled
            value=""
            className="block w-full rounded-md border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground"
          >
            <option value="">
              활성 Optimizer{" "}
              {prompts?.optimizer?.find((p) => p.is_active)
                ? `(v${prompts.optimizer.find((p) => p.is_active)!.version})`
                : ""}
            </option>
          </select>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-[12px] text-muted-foreground">
          {err ? (
            <span className="text-destructive">{err}</span>
          ) : (
            "백그라운드 실행. 진행은 아래에서 폴링합니다. (Generator는 느립니다)"
          )}
        </span>
        <Button onClick={run} disabled={busy}>
          <Play className="size-4" />
          {busy ? "시작 중…" : "학습 실행"}
        </Button>
      </div>
    </div>
  );
}

function RunDetail({
  runId,
  canEdit,
  onChanged,
}: {
  runId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [run, setRun] = useState<OptRun | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetchRun(runId);
        if (!alive) return;
        setRun(r);
        if (r.status === "running") timer.current = setTimeout(tick, 3000);
      } catch {
        /* ignore */
      }
    }
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId]);

  if (!run)
    return (
      <div className="mt-2 mb-3 rounded-xl border p-5">
        <Skeleton className="h-20 w-full" />
      </div>
    );

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      const r = await fetchRun(runId);
      setRun(r);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 mb-3 space-y-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <RunStatus status={run.status} />
        {run.status === "running" && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> 실행 중…
          </span>
        )}
        <span className="text-muted-foreground">예시 {run.example_count}</span>
        <a
          href={`/optimize/run?id=${run.id}`}
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          전체 관제 ↗
        </a>
      </div>

      {run.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {run.error}
        </div>
      )}

      {run.aggregated_gap && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            통합 격차 (이 노드가 받은 진단)
          </div>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[12.5px] leading-relaxed">
            {run.aggregated_gap}
          </pre>
        </div>
      )}

      {run.candidate_prompt && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            후보 프롬프트 (optimizer 산출)
          </div>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-[12.5px] leading-relaxed">
            {run.candidate_prompt}
          </pre>
        </div>
      )}

      {run.status === "awaiting_review" && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-[12px] text-muted-foreground">
            격차와 후보를 읽고 직접 판단하세요.
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => act(() => discardRun(run.id))}
            >
              폐기
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act(() => promoteRun(run.id, false))}
            >
              승격 (비활성)
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act(() => promoteRun(run.id, true))}>
              승격 + 활성화
            </Button>
          </div>
        </div>
      )}
      {run.status === "promoted" && run.produced_prompt_id && (
        <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-400">
          <Check className="mr-1 inline size-3.5" />
          새 {run.target_kind} 버전으로 승격됨. ‘모델’ 탭에서 확인/활성화하세요.
        </div>
      )}
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    running: ["실행 중", "bg-muted text-muted-foreground"],
    awaiting_review: ["검토 대기", "bg-amber-500/10 text-amber-700 dark:text-amber-400"],
    promoted: ["승격됨", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"],
    discarded: ["폐기", "bg-muted text-muted-foreground"],
    error: ["오류", "bg-destructive/10 text-destructive"],
  };
  const [label, cls] = map[status] ?? [status, "bg-muted text-muted-foreground"];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
