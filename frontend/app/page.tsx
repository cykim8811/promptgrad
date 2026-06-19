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

type Preset = { label: string; spec: string; audience: string };

const PRESETS: Preset[] = [
  {
    label: "역전파",
    spec: "신경망의 역전파(Back Propagation)가 무엇이고, 왜 그리고 어떻게 동작하는가. 손실(loss)을 출력에서 입력 방향으로 전파하면서, 각 가중치가 손실에 얼마나 기여했는지(기울기)를 연쇄법칙으로 계산하고, 그 기울기로 가중치를 조금씩 갱신해 학습이 이루어지는 원리.",
    audience: "미적분의 연쇄법칙은 알지만 딥러닝은 처음인 학부생",
  },
  {
    label: "재귀",
    spec: "재귀(recursion)란 무엇이고 왜 동작하는가. 함수가 자기 자신을 호출해 문제를 더 작은 같은 종류의 문제로 환원하는 방식과, 무한히 내려가지 않게 하는 베이스 케이스의 역할.",
    audience: "프로그래밍을 처음 배우는 고등학생",
  },
  {
    label: "베이즈 정리",
    spec: "베이즈 정리가 무엇이고 직관적으로 왜 성립하는가. 사전확률을 새로운 증거로 갱신해 사후확률을 얻는 과정과, 분모(전체 증거 확률)가 하는 역할.",
    audience: "확률의 기초(조건부확률)만 아는 일반 성인",
  },
  {
    label: "정보 엔트로피",
    spec: "정보 엔트로피가 무엇을 측정하는가. '평균적인 놀라움/불확실성'이라는 직관과, 왜 확률에 로그를 취해 정의하는가.",
    audience: "고등학교 수학(로그)을 마친 학생",
  },
  {
    label: "어텐션",
    spec: "트랜스포머의 self-attention이 무엇을 하는가. 각 토큰이 query/key/value를 통해 다른 토큰들을 가중 참조해 문맥을 모으는 메커니즘과, 그것이 왜 강력한가.",
    audience: "기본적인 신경망은 아는 개발자",
  },
  {
    label: "복리",
    spec: "복리가 단리와 어떻게 다르고, 왜 장기적으로는 폭발적으로 커지는가. 이자가 다시 이자를 낳는 구조와 지수적 성장의 직관.",
    audience: "금융 지식이 거의 없는 사회초년생",
  },
];

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
      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          프리셋 명세
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const active = spec === p.spec;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setSpec(p.spec);
                  setAudience(p.audience);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

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
