"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/Markdown";
import { StatusPill } from "@/components/StatusPill";
import { SignInLink } from "@/components/SignIn";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/identity";
import {
  evaluateSession,
  fetchSession,
  setSessionArchived,
  submitFeedback,
  type Card,
  type SessionDetail,
} from "@/lib/api";

export default function SessionPage() {
  return (
    <Suspense fallback={<div className="pt-8"><Skeleton className="h-64 w-full" /></div>}>
      <SessionView />
    </Suspense>
  );
}

function SessionView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const [session, setSession] = useState<SessionDetail | null | undefined>(undefined);
  const [evaluating, setEvaluating] = useState(false);
  const [tab, setTab] = useState<"A" | "B">("A");
  const autoEval = useRef(false);

  useEffect(() => {
    if (!id) {
      setSession(null);
      return;
    }
    fetchSession(id).then(setSession).catch(() => setSession(null));
  }, [id]);

  // Auto-run the Evaluator once candidates exist but no verdict yet.
  useEffect(() => {
    if (!session || autoEval.current) return;
    if (
      session.status !== "error" &&
      session.candidate_a &&
      session.candidate_b &&
      !session.evaluation
    ) {
      autoEval.current = true;
      setEvaluating(true);
      evaluateSession(session.id)
        .then(setSession)
        .catch(() => {})
        .finally(() => setEvaluating(false));
    }
  }, [session]);

  if (session === undefined)
    return (
      <div className="space-y-4 pt-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );

  if (session === null)
    return (
      <div className="space-y-4 pt-8">
        <p className="text-[15px] text-muted-foreground">
          세션을 찾을 수 없습니다.
        </p>
        <BackLink />
      </div>
    );

  if (session.status === "error")
    return (
      <div className="space-y-4 pt-8">
        <BackLink />
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-[14px] text-destructive">
          {session.error || "생성 중 오류가 발생했습니다."}
        </div>
      </div>
    );

  const evalWinner = session.evaluation?.winner;

  return (
    <div className="space-y-8 pt-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <ArchiveButton session={session} onUpdate={setSession} />
      </div>

      {/* Spec */}
      <section className="space-y-3 rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            명세
          </h1>
          <StatusPill session={session} />
        </div>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {session.spec}
        </p>
        {session.audience && (
          <p className="text-[13px] text-muted-foreground">
            <span className="font-medium text-foreground">대상 독자</span> ·{" "}
            {session.audience}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[12px] text-muted-foreground">
          {session.generator && (
            <span>
              Generator: v{session.generator.version} {session.generator.name} ·{" "}
              {session.generator.model}
            </span>
          )}
          {session.evaluator && (
            <span>
              Evaluator: v{session.evaluator.version} {session.evaluator.name} ·{" "}
              {session.evaluator.model}
            </span>
          )}
        </div>
      </section>

      {/* A/B viewer */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border p-0.5">
            {(["A", "B"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  tab === t
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                설명안 {t}
                {evalWinner === t && (
                  <Check
                    className={cn(
                      "size-3.5",
                      tab === t ? "text-background" : "text-emerald-600"
                    )}
                  />
                )}
              </button>
            ))}
          </div>
          {evalWinner && (
            <span className="text-[12px] text-muted-foreground">
              <Check className="mr-0.5 inline size-3.5 text-emerald-600" />
              Evaluator는 {evalWinner}안을 선택
            </span>
          )}
        </div>

        <CardStack cards={tab === "A" ? session.candidate_a : session.candidate_b} />
      </section>

      {/* Evaluator verdict */}
      <EvaluatorPanel session={session} evaluating={evaluating} />

      {/* Human feedback */}
      <FeedbackPanel session={session} onUpdate={setSession} />
    </div>
  );
}

function ArchiveButton({
  session,
  onUpdate,
}: {
  session: SessionDetail;
  onUpdate: (s: SessionDetail) => void;
}) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await setSessionArchived(session.id, !session.archived);
      onUpdate(updated);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      {session.archived ? (
        <>
          <ArchiveRestore className="size-3.5" />
          보관 해제
        </>
      ) : (
        <>
          <Archive className="size-3.5" />
          보관
        </>
      )}
    </button>
  );
}

function CardStack({ cards }: { cards: Card[] }) {
  if (!cards || cards.length === 0)
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center text-[13px] text-muted-foreground">
        내용이 없습니다.
      </div>
    );
  return (
    <ol className="space-y-3">
      {cards.map((card, i) => (
        <li key={i} className="rounded-xl border p-5 sm:p-6">
          <div className="flex items-baseline gap-2.5">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold tabular-nums text-background">
              {i + 1}
            </span>
            {card.title && (
              <h3 className="text-[15px] font-semibold leading-snug">{card.title}</h3>
            )}
          </div>
          {card.body && (
            <div className="mt-2 pl-[30px]">
              <Markdown>{card.body}</Markdown>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function EvaluatorPanel({
  session,
  evaluating,
}: {
  session: SessionDetail;
  evaluating: boolean;
}) {
  const ev = session.evaluation;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Evaluator 판단
      </h2>
      {!ev ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed px-5 py-4 text-[14px] text-muted-foreground">
          {evaluating ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Evaluator가 두 설명을 비교하는 중…
            </>
          ) : (
            "아직 평가되지 않았습니다."
          )}
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border p-5">
          <p className="text-[15px] leading-relaxed">
            <span className="font-medium">→ {ev.winner}안</span>이 더 이해하기 쉽다고
            판단했습니다.
          </p>
          {ev.reason && (
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              {ev.reason}
            </p>
          )}
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <Critique label="A" text={ev.critique_a} won={ev.winner === "A"} />
            <Critique label="B" text={ev.critique_b} won={ev.winner === "B"} />
          </div>
        </div>
      )}
    </section>
  );
}

function Critique({
  label,
  text,
  won,
}: {
  label: string;
  text: string;
  won: boolean;
}) {
  if (!text) return null;
  return (
    <div className="space-y-1">
      <p
        className={cn(
          "flex items-center gap-1 text-[12px] font-medium",
          won ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        )}
      >
        {won && <Check className="size-3.5" />}
        설명안 {label}
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function FeedbackPanel({
  session,
  onUpdate,
}: {
  session: SessionDetail;
  onUpdate: (s: SessionDetail) => void;
}) {
  const me = useMe();
  const existing = session.feedback;
  const [choice, setChoice] = useState<"A" | "B" | null>(existing?.choice ?? null);
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [understanding, setUnderstanding] = useState(existing?.understanding ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(!existing);

  // Sync when the session changes (e.g. after load).
  useEffect(() => {
    setChoice(session.feedback?.choice ?? null);
    setReason(session.feedback?.reason ?? "");
    setUnderstanding(session.feedback?.understanding ?? "");
    setEditing(!session.feedback);
  }, [session.id, session.feedback]);

  async function save() {
    if (!choice || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await submitFeedback(session.id, {
        choice,
        reason: reason.trim(),
        understanding: understanding.trim(),
      });
      onUpdate(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        당신의 판단
      </h2>

      {session.agreement !== null && !editing && (
        <div
          className={cn(
            "rounded-md px-4 py-2.5 text-[13px]",
            session.agreement
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {session.agreement
            ? "Evaluator와 당신의 선택이 일치합니다."
            : "Evaluator와 당신의 선택이 다릅니다 — 가장 값진 학습 신호입니다."}
        </div>
      )}

      {me === null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
          <p className="text-[14px] text-muted-foreground">
            선택과 이유를 남기려면 로그인하세요.
          </p>
          <SignInLink />
        </div>
      ) : !editing && existing ? (
        <div className="space-y-3 rounded-xl border p-5">
          <p className="text-[15px]">
            당신의 선택: <span className="font-medium">{existing.choice}안</span>
          </p>
          {existing.reason && (
            <Field label="더 이해가 잘 된 이유">{existing.reason}</Field>
          )}
          {existing.understanding && (
            <Field label="어떻게 이해되었는지 / 막혔던 부분">
              {existing.understanding}
            </Field>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            수정
          </Button>
        </div>
      ) : (
        <div className="space-y-5 rounded-xl border p-5">
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">
              어느 쪽이 더 이해가 잘 됩니까?
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(["A", "B"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChoice(c)}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-[14px] font-medium transition-colors",
                    choice === c
                      ? "border-foreground bg-foreground text-background"
                      : "hover:border-foreground/40"
                  )}
                >
                  설명안 {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">
              더 이해가 잘 된 이유{" "}
              <span className="font-normal text-muted-foreground">
                (Evaluator 학습의 핵심 재료)
              </span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={8000}
              placeholder="무엇 때문에 더 잘 이해됐나요? 구체적일수록 좋습니다."
              className="block w-full resize-y rounded-md border bg-transparent px-3.5 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">
              어떻게 이해되었는지 / 막혔던 부분{" "}
              <span className="font-normal text-muted-foreground">(선택)</span>
            </label>
            <textarea
              value={understanding}
              onChange={(e) => setUnderstanding(e.target.value)}
              rows={3}
              maxLength={8000}
              placeholder="이 설명이 머릿속에서 어떻게 그려졌는지, 어디서 헷갈렸는지."
              className="block w-full resize-y rounded-md border bg-transparent px-3.5 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <span className="text-[12px] text-destructive">{err}</span>
            <div className="flex gap-2">
              {existing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                >
                  취소
                </Button>
              )}
              <Button onClick={save} disabled={busy || !choice}>
                {busy ? "저장 중…" : "선택 저장"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{children}</p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      세션 목록
    </Link>
  );
}
