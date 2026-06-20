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
  type OptStep,
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
          라벨된 세션을 데이터로, Evaluator 프롬프트를 <b className="text-foreground">사람의
          이유</b>에 정렬시킵니다. forward → 의미적 loss → 자연어 gradient →
          step을 반복하고, held-out 검증을 통과한 후보만 새 버전으로 승격합니다.
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
          실행 기록
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
                  {r.target_kind} · {r.loss_type}
                  <span className="text-muted-foreground">
                    {" "}· train {r.train_count}/val {r.val_count}
                    {r.created_at
                      ? ` · ${new Date(r.created_at).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <RunStatus status={r.status} />
              </button>
              {selected === r.id && (
                <RunDetail
                  runId={r.id}
                  canEdit={!!me}
                  onChanged={reloadRuns}
                />
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
    ["train", stats?.train],
    ["val (held-out)", stats?.val],
    ["불일치", stats?.disagreements],
  ] as const;
  return (
    <div className="grid grid-cols-4 gap-2">
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
  const [nIters, setNIters] = useState(3);
  const [batch, setBatch] = useState(4);
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
        config: { n_iters: nIters, batch_size: batch },
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
      {target === "generator" && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          새 Generator의 생성물을 <b className="text-foreground">활성 Evaluator</b>가
          판정해, 사람이 선호했던 설명(참조)을 이기는지로 학습합니다.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="base 버전">
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
        <Field label="loss">
          <input
            value={
              target === "evaluator"
                ? "rationale_recovery (이유 회복도)"
                : "understandability (참조 대비 승리)"
            }
            disabled
            className="block w-full rounded-md border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground"
          />
        </Field>
        <Field label="반복(n_iters)">
          <input
            type="number"
            min={1}
            max={8}
            value={nIters}
            onChange={(e) => setNIters(Number(e.target.value))}
            className="block w-full rounded-md border bg-transparent px-3 py-2 text-[13px] tabular-nums focus:border-foreground/40 focus:outline-none"
          />
        </Field>
        <Field label="배치 크기">
          <input
            type="number"
            min={1}
            max={16}
            value={batch}
            onChange={(e) => setBatch(Number(e.target.value))}
            className="block w-full rounded-md border bg-transparent px-3 py-2 text-[13px] tabular-nums focus:border-foreground/40 focus:outline-none"
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-[12px] text-muted-foreground">
          {err ? (
            <span className="text-destructive">{err}</span>
          ) : (
            "실행은 백그라운드에서 돕니다. 아래에서 진행 상황을 폴링합니다."
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

  const steps = run.steps ?? [];

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
      {/* status line */}
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <RunStatus status={run.status} />
        {run.status === "running" && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> 실행 중… (스텝 {steps.length})
          </span>
        )}
        {run.base_val_score !== null && (
          <span className="text-muted-foreground">
            base val <b className="text-foreground tabular-nums">
              {run.base_val_score.toFixed(3)}
            </b>
          </span>
        )}
        {run.val_count === 0 && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            val 없음 — greedy 채택(검증 신뢰도 낮음)
          </span>
        )}
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

      {steps.length > 0 && <LossChart run={run} steps={steps} />}

      {/* steps */}
      <div className="space-y-2">
        {steps.map((s) => (
          <StepCard key={s.idx} step={s} isBest={s.idx === run.best_step_idx} />
        ))}
      </div>

      {/* review gate */}
      {run.status === "awaiting_review" && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-[12px] text-muted-foreground">
            {run.best_step_idx !== null
              ? `step ${run.best_step_idx}의 후보를 새 Evaluator 버전으로 승격할 수 있습니다.`
              : "검증을 통과한 개선 후보가 없습니다."}
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
            {run.best_step_idx !== null && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => act(() => promoteRun(run.id, false))}
                >
                  승격 (비활성)
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => act(() => promoteRun(run.id, true))}
                >
                  승격 + 활성화
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {run.status === "promoted" && run.produced_prompt_id && (
        <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-400">
          <Check className="mr-1 inline size-3.5" />
          새 Evaluator 버전으로 승격됨. ‘모델’ 탭에서 확인/활성화하세요.
        </div>
      )}
    </div>
  );
}

function LossChart({ run, steps }: { run: OptRun; steps: OptStep[] }) {
  // train_loss line (always present); base_val baseline if available.
  const W = 520,
    H = 150,
    PL = 36,
    PR = 16,
    PT = 14,
    PB = 26;
  const vals = steps.map((s) => s.train_loss);
  if (run.base_val_score !== null) vals.push(run.base_val_score);
  const maxY = Math.max(1, ...vals) * 1.1;
  const n = steps.length;
  const x = (i: number) =>
    PL + (n <= 1 ? 0 : (i / (n - 1)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - v / maxY) * (H - PT - PB);
  const pts = steps.map((s, i) => `${x(i)},${y(s.train_loss)}`).join(" ");
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={PL} y1={y(0)} x2={W - PR} y2={y(0)} stroke="currentColor" className="text-border" />
        {run.base_val_score !== null && (
          <line
            x1={PL}
            y1={y(run.base_val_score)}
            x2={W - PR}
            y2={y(run.base_val_score)}
            strokeDasharray="4 4"
            stroke="currentColor"
            className="text-muted-foreground/50"
          />
        )}
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2.5}
          className="text-foreground" strokeLinejoin="round" />
        {steps.map((s, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(s.train_loss)} r={4}
              className={s.accepted ? "fill-emerald-500" : "fill-muted-foreground"} />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground"
              fontSize="10" fontFamily="ui-monospace,monospace">s{s.idx}</text>
            <text x={x(i)} y={y(s.train_loss) - 8} textAnchor="middle" className="fill-foreground"
              fontSize="10" fontFamily="ui-monospace,monospace" fontWeight="700">
              {s.train_loss.toFixed(2)}
            </text>
          </g>
        ))}
      </svg>
      <p className="px-1 text-[11px] text-muted-foreground">
        train loss (점=스텝, 초록=채택){run.base_val_score !== null ? " · 점선=base val" : ""}
      </p>
    </div>
  );
}

function StepCard({ step, isBest }: { step: OptStep; isBest: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isBest && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-medium">
          step {step.idx}
          {isBest && (
            <span className="ml-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              ★ best
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground tabular-nums">
          train {step.train_loss.toFixed(3)}
          {step.val_score !== null && ` · val ${step.val_score.toFixed(3)}`}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              step.accepted
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {step.accepted ? "채택" : "기각"}
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              gradient ∂loss/∂prompt
            </div>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2.5 text-[12px] leading-relaxed">
              {step.gradient_text || "—"}
            </pre>
          </div>
          {step.candidate_prompt && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                후보 프롬프트
              </div>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2.5 text-[12px] leading-relaxed">
                {step.candidate_prompt}
              </pre>
            </div>
          )}
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
