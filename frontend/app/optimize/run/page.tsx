"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchRun, type OptItem, type OptRun } from "@/lib/api";

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

  const items = run.items ?? [];

  return (
    <div className="space-y-6 pt-6">
      <BackLink />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            학습 관제 · <span className="capitalize">{run.target_kind}</span>
          </h1>
          <RunStatus status={run.status} />
        </div>
        <p className="text-[12px] text-muted-foreground">
          예시 {run.example_count} · forward → 격차 서술(loss) → 원인 분석(backward) →
          통합 → optimizer 후보. 수치 없음, 자동 게이트 없음.
        </p>
      </header>

      {run.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {run.error}
        </div>
      )}

      {run.base_prompt && (
        <Disclosure title={`base 프롬프트 · v${run.base_prompt.version} ${run.base_prompt.name}`}>
          <Pre>{run.base_prompt.template}</Pre>
        </Disclosure>
      )}

      {/* per-example items */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          예시별 forward / loss / backward
        </h2>
        {items.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/40 px-5 py-6 text-center text-[13px] text-muted-foreground">
            {run.status === "running" ? "측정 중…" : "항목이 없습니다."}
          </p>
        )}
        {items.map((it, i) => (
          <ItemCard key={i} item={it} />
        ))}
      </section>

      {/* aggregated gap */}
      {run.aggregated_gap && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
            통합 격차 (이 노드가 받은 진단)
          </h2>
          <Pre tone="amber">{run.aggregated_gap}</Pre>
        </section>
      )}

      {/* candidate */}
      {run.candidate_prompt && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            후보 프롬프트 (optimizer 산출)
          </h2>
          <Pre>{run.candidate_prompt}</Pre>
        </section>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: OptItem }) {
  return (
    <div className="space-y-2.5 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium">{item.spec}</p>
        {item.session_id && (
          <Link
            href={`/session?id=${item.session_id}`}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            세션 <ExternalLink className="size-3" />
          </Link>
        )}
      </div>
      <Block label="forward · 노드 출력" tone="plain">
        {item.forward_output}
      </Block>
      <Block label="loss · 이상과 현재의 격차 (서술)" tone="muted">
        {item.loss_text}
      </Block>
      <Block label="backward · 원인 + 격차 (선언형)" tone="amber">
        {item.backward_text}
      </Block>
    </div>
  );
}

function Block({
  label,
  children,
  tone,
}: {
  label: string;
  children: string;
  tone: "plain" | "muted" | "amber";
}) {
  return (
    <div>
      <div
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide",
          tone === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          "mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border p-2.5 text-[12.5px] leading-relaxed",
          tone === "amber" ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/40"
        )}
      >
        {children || "—"}
      </pre>
    </div>
  );
}

function Disclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px] font-semibold text-muted-foreground"
      >
        <span>{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function Pre({ children, tone }: { children: string; tone?: "amber" }) {
  return (
    <pre
      className={cn(
        "max-h-[30rem] overflow-auto whitespace-pre-wrap rounded-md border p-3 text-[12.5px] leading-relaxed",
        tone === "amber" ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/40"
      )}
    >
      {children}
    </pre>
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
