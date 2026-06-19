"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInLink } from "@/components/SignIn";
import { StatusPill } from "@/components/StatusPill";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/identity";
import {
  createSession,
  fetchPrompts,
  fetchSessions,
  fetchStats,
  type Prompt,
  type SessionSummary,
  type Stats,
} from "@/lib/api";

export default function HomePage() {
  return (
    <div className="space-y-12 pt-4">
      <Hero />
      <NewSession />
      <Recent />
    </div>
  );
}

function Hero() {
  return (
    <header className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        가장 이해가 잘 되는 설명을 찾는다
      </h1>
      <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        <b className="font-medium text-foreground">Generator</b>가 같은 명세에 대해
        두 가지 설명안(A/B)을 만들고,{" "}
        <b className="font-medium text-foreground">Evaluator</b>가 어느 쪽이 더 나은지
        판단합니다. 그다음 당신이 직접 읽고 더 이해가 잘 되는 쪽을 고르고 이유를 남깁니다.
        이 선택과 이유가 두 모델을 학습시키는 데이터가 됩니다.
      </p>
    </header>
  );
}

function NewSession() {
  const me = useMe();
  const router = useRouter();
  const [spec, setSpec] = useState("");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [prompts, setPrompts] = useState<Record<string, Prompt[]> | null>(null);
  const [genId, setGenId] = useState("");
  const [evalId, setEvalId] = useState("");

  useEffect(() => {
    if (showAdv && !prompts) fetchPrompts().then(setPrompts).catch(() => {});
  }, [showAdv, prompts]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!spec.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await createSession({
        spec: spec.trim(),
        audience: audience.trim(),
        generator_prompt_id: genId || undefined,
        evaluator_prompt_id: evalId || undefined,
      });
      router.push(`/session?id=${s.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (me === undefined)
    return <Skeleton className="h-48 w-full rounded-xl" />;

  if (!me)
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
        <p className="text-[14px] text-muted-foreground">
          새 세션을 시작하려면 로그인하세요.
        </p>
        <SignInLink />
      </div>
    );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border p-5 transition-colors focus-within:border-foreground/30"
    >
      <div className="space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          명세 — 이해시키고자 하는 대상 지식
        </label>
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          rows={4}
          required
          maxLength={8000}
          placeholder="예: 재귀(recursion)란 무엇이고 왜 동작하는가"
          className="block w-full resize-y rounded-md border bg-transparent px-3.5 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          대상 독자 <span className="normal-case opacity-70">(선택)</span>
        </label>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          maxLength={2000}
          placeholder="예: 프로그래밍을 처음 배우는 고등학생"
          className="block w-full rounded-md border bg-transparent px-3.5 py-2.5 text-[15px] placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdv((v) => !v)}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", showAdv && "rotate-180")}
          />
          모델 버전 지정 (고급)
        </button>
        {showAdv && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ModelSelect
              label="Generator"
              value={genId}
              onChange={setGenId}
              options={prompts?.generator ?? []}
            />
            <ModelSelect
              label="Evaluator"
              value={evalId}
              onChange={setEvalId}
              options={prompts?.evaluator ?? []}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-[12px] text-muted-foreground">
          {err ? (
            <span className="text-destructive">{err}</span>
          ) : busy ? (
            "Generator가 두 설명안을 작성하는 중… (수십 초 걸릴 수 있어요)"
          ) : (
            "비활성 모델은 '고급'에서 고를 수 있어요."
          )}
        </span>
        <Button type="submit" disabled={busy || !spec.trim()}>
          <Sparkles className="size-4" />
          {busy ? "생성 중…" : "설명안 생성"}
        </Button>
      </div>
    </form>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Prompt[];
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border bg-background px-3 py-2 text-[13px] focus:border-foreground/40 focus:outline-none"
      >
        <option value="">활성 버전 (기본)</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            v{p.version} · {p.name} ({p.model}){p.is_active ? " · 활성" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Recent() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
    fetchStats().then(setStats).catch(() => {});
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          최근 세션
        </h2>
        {stats && <StatsLine stats={stats} />}
      </div>
      <ul className="space-y-1">
        {sessions === null && (
          <>
            <li>
              <Skeleton className="h-14 w-full" />
            </li>
            <li>
              <Skeleton className="h-14 w-full" />
            </li>
          </>
        )}
        {sessions && sessions.length === 0 && (
          <li className="rounded-md border border-dashed bg-muted/40 px-5 py-8 text-center text-[13px] text-muted-foreground">
            아직 세션이 없습니다. 위에서 첫 명세를 입력해 보세요.
          </li>
        )}
        {sessions?.map((s) => (
          <li key={s.id}>
            <Link
              href={`/session?id=${s.id}`}
              className="group -mx-3 flex items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">
                  {s.spec || "(빈 명세)"}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {s.audience ? `대상: ${s.audience}` : "대상 미지정"}
                  {s.created_at
                    ? ` · ${new Date(s.created_at).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill session={s} />
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatsLine({ stats }: { stats: Stats }) {
  return (
    <p className="text-[12px] text-muted-foreground tabular-nums">
      세션 {stats.total_sessions} · 라벨 {stats.feedbacks}
      {stats.agreement_rate !== null && (
        <>
          {" "}
          · 일치율 {(stats.agreement_rate * 100).toFixed(0)}%
        </>
      )}
    </p>
  );
}
