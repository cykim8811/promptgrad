"use client";

import { cn } from "@/lib/utils";

type PillSession = {
  status: string;
  has_evaluation?: boolean;
  has_feedback?: boolean;
  agreement?: boolean | null;
};

/** Compact state badge for a session row / header. */
export function StatusPill({ session }: { session: PillSession }) {
  const { status, agreement } = session;

  let label = "생성됨";
  let tone = "muted";

  if (status === "generating") {
    label = "생성 중";
    tone = "muted";
  } else if (status === "error") {
    label = "오류";
    tone = "danger";
  } else if (status === "done" || session.has_feedback) {
    if (agreement === true) {
      label = "일치";
      tone = "ok";
    } else if (agreement === false) {
      label = "불일치";
      tone = "warn";
    } else {
      label = "피드백 완료";
      tone = "ok";
    }
  } else if (status === "evaluated" || session.has_evaluation) {
    label = "평가됨";
    tone = "info";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "info" && "bg-muted text-foreground",
        tone === "ok" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warn" &&
          "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "danger" && "bg-destructive/10 text-destructive"
      )}
    >
      {label}
    </span>
  );
}
