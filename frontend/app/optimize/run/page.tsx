"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchRun, type OptRun, type OptStep } from "@/lib/api";

type Rec = {
  session_id: string;
  spec: string;
  human_choice: string;
  human_rationale: string;
  eval_winner: string;
  eval_reason: string;
  choice_match: number;
  coverage: number;
  loss: number;
};

export default function RunMonitorPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-8">
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <Monitor />
    </Suspense>
  );
}

function Monitor() {
  const id = useSearchParams().get("id") ?? "";
  const [run, setRun] = useState<OptRun | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetchRun(id);
        if (!alive) return;
        setRun(r);
        if (r.status === "running") timer.current = setTimeout(tick, 3000);
      } catch {
        if (alive) setRun(null);
      }
    }
    if (id) tick();
    else setRun(null);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  if (run === undefined)
    return (
      <div className="space-y-4 pt-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (run === null)
    return (
      <div className="space-y-4 pt-8">
        <BackLink />
        <p className="text-[15px] text-muted-foreground">실행을 찾을 수 없습니다.</p>
      </div>
    );

  const cfg = run.config ?? {};
  const wChoice = Number(cfg.w_choice ?? 0.4);
  const wCov = Number(cfg.w_cov ?? 0.6);
  const steps = run.steps ?? [];

  return (
    <div className="space-y-6 pt-6">
      <BackLink />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            학습 관제 · {run.target_kind}
          </h1>
          <RunStatus status={run.status} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <Chip>loss: {run.loss_type}</Chip>
          <Chip>n_iters {String(cfg.n_iters ?? "")}</Chip>
          <Chip>batch {String(cfg.batch_size ?? "")}</Chip>
          <Chip>w_choice {wChoice} · w_cov {wCov}</Chip>
          <Chip>model {String(cfg.model ?? "")}</Chip>
          <Chip>judge {String(cfg.judge_model ?? "")}</Chip>
          <Chip>train {run.train_count} · val {run.val_count}</Chip>
          {run.base_val_score !== null && (
            <Chip>base val {run.base_val_score.toFixed(3)}</Chip>
          )}
        </div>
      </header>

      {/* loss explainer */}
      <div className="rounded-xl border bg-muted/30 p-4 text-[13px] leading-relaxed">
        <b>loss 측정</b> — 예시마다:{" "}
        <code className="rounded bg-background px-1.5 py-0.5 text-[12px]">
          {wChoice}·(1−choice_match) + {wCov}·(1−coverage)
        </code>{" "}
        (0~1, 낮을수록 좋음). <b>choice_match</b>=사람 선택과 일치(1/0),{" "}
        <b>coverage</b>=Evaluator의 이유가 사람의 이유를 회복한 정도(judge, 0~1).
        step의 <b>train loss</b>는 미니배치 평균, <b>val</b>은 held-out 평균.
      </div>

      {/* base prompt */}
      {run.base_prompt && (
        <Disclosure title={`base 프롬프트 · v${run.base_prompt.version} ${run.base_prompt.name}`}>
          <Pre>{run.base_prompt.template}</Pre>
        </Disclosure>
      )}

      {/* steps */}
      {steps.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/40 px-5 py-6 text-center text-[13px] text-muted-foreground">
          {run.status === "running" ? "첫 스텝 측정 중…" : "스텝이 없습니다."}
        </p>
      )}

      {steps.map((s) => (
        <StepBlock
          key={s.idx}
          step={s}
          isBest={s.idx === run.best_step_idx}
          wChoice={wChoice}
          wCov={wCov}
        />
      ))}
    </div>
  );
}

function StepBlock({
  step,
  isBest,
  wChoice,
  wCov,
}: {
  step: OptStep;
  isBest: boolean;
  wChoice: number;
  wCov: number;
}) {
  const records = (step.records ?? []) as unknown as Rec[];
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border p-5",
        isBest && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">
          step {step.idx}
          {isBest && (
            <span className="ml-2 text-[12px] text-emerald-600 dark:text-emerald-400">
              ★ best
            </span>
          )}
        </h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          train loss <b className="text-foreground">{step.train_loss.toFixed(3)}</b>
          {step.val_score !== null && (
            <> · val <b className="text-foreground">{step.val_score.toFixed(3)}</b></>
          )}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            step.accepted
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {step.accepted ? "채택" : "기각"}
        </span>
      </div>

      {/* per-example records */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          예시별 측정 ({records.length})
        </div>
        {records.map((r, i) => (
          <ExampleCard key={i} r={r} wChoice={wChoice} wCov={wCov} />
        ))}
      </div>

      {step.gradient_text && (
        <Disclosure title="gradient ∂loss/∂prompt" tone="amber" defaultOpen>
          <Pre>{step.gradient_text}</Pre>
        </Disclosure>
      )}
      {step.candidate_prompt && (
        <Disclosure title="후보 프롬프트 (이 step 산출)">
          <Pre>{step.candidate_prompt}</Pre>
        </Disclosure>
      )}
    </section>
  );
}

function ExampleCard({
  r,
  wChoice,
  wCov,
}: {
  r: Rec;
  wChoice: number;
  wCov: number;
}) {
  return (
    <div className="rounded-lg border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium">{r.spec}</p>
        <Link
          href={`/session?id=${r.session_id}`}
          className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          세션 <ExternalLink className="size-3" />
        </Link>
      </div>

      <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-muted/40 p-2.5">
          <div className="text-[11px] font-semibold text-foreground">
            사람 → {r.human_choice}안
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
            {r.human_rationale || "(이유 없음)"}
          </p>
        </div>
        <div
          className={cn(
            "rounded-md p-2.5",
            r.choice_match ? "bg-emerald-500/5" : "bg-amber-500/5"
          )}
        >
          <div className="text-[11px] font-semibold text-foreground">
            Evaluator → {r.eval_winner}안{" "}
            <span
              className={cn(
                r.choice_match
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              )}
            >
              {r.choice_match ? "(일치)" : "(불일치)"}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
            {r.eval_reason || "—"}
          </p>
        </div>
      </div>

      {/* loss breakdown */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] tabular-nums">
        <span className="text-muted-foreground">
          match <b className="text-foreground">{r.choice_match}</b>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          coverage
          <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-border align-middle">
            <span
              className="block h-full bg-foreground"
              style={{ width: `${Math.round(r.coverage * 100)}%` }}
            />
          </span>
          <b className="text-foreground">{r.coverage}</b>
        </span>
        <span className="text-muted-foreground">
          = {wChoice}·(1−{r.choice_match}) + {wCov}·(1−{r.coverage}) ={" "}
          <b className="text-foreground">{r.loss}</b>
        </span>
      </div>
    </div>
  );
}

function Disclosure({
  title,
  children,
  tone,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "amber";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px] font-semibold",
          tone === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        )}
      >
        <span>{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-[12.5px] leading-relaxed">
      {children}
    </pre>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border px-2 py-0.5">{children}</span>
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

function BackLink() {
  return (
    <Link
      href="/optimize"
      className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      학습
    </Link>
  );
}
