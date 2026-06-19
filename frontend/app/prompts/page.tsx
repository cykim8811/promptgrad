"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInLink } from "@/components/SignIn";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/identity";
import {
  activatePrompt,
  createPrompt,
  fetchModels,
  fetchPrompts,
  type Prompt,
} from "@/lib/api";

type Kind = "generator" | "evaluator";

const KIND_DESC: Record<Kind, string> = {
  generator: "명세를 받아 두 가지 설명안(A/B)을 생성합니다. {spec}, {audience} 사용 가능.",
  evaluator: "두 설명을 비교해 더 나은 쪽을 고릅니다. {spec}, {a}, {b} 사용 가능.",
};

export default function PromptsPage() {
  const me = useMe();
  const [kind, setKind] = useState<Kind>("generator");
  const [prompts, setPrompts] = useState<Record<string, Prompt[]> | null>(null);
  const [models, setModels] = useState<{ models: string[]; default: string } | null>(
    null
  );
  const [draft, setDraft] = useState<Partial<Prompt> | null>(null);

  function reload() {
    fetchPrompts().then(setPrompts).catch(() => setPrompts({}));
  }
  useEffect(() => {
    reload();
    fetchModels().then(setModels).catch(() => {});
  }, []);

  const list = useMemo(() => prompts?.[kind] ?? [], [prompts, kind]);

  async function onActivate(id: string) {
    await activatePrompt(id);
    reload();
  }

  return (
    <div className="space-y-8 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">모델 (프롬프트)</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          하나의 모델은 입력을 출력으로 바꾸는 프롬프트입니다. 버전을 쌓아가며
          개선하고, 세션마다 어떤 버전을 쓸지 고를 수 있습니다. 활성 버전이 기본값입니다.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border p-0.5">
          {(["generator", "evaluator"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setDraft(null);
              }}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors",
                kind === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {k}
            </button>
          ))}
        </div>
        {me && !draft && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({
                kind,
                model: models?.default,
                max_tokens: kind === "generator" ? 4000 : 2000,
                temperature: kind === "generator" ? 1.0 : 0.3,
              })
            }
          >
            <Plus className="size-4" /> 새 버전
          </Button>
        )}
      </div>

      <p className="text-[13px] text-muted-foreground">{KIND_DESC[kind]}</p>

      {!me && me !== undefined && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
          <p className="text-[14px] text-muted-foreground">
            새 버전을 만들거나 활성화하려면 로그인하세요. (열람은 누구나 가능)
          </p>
          <SignInLink />
        </div>
      )}

      {draft && models && (
        <PromptEditor
          kind={kind}
          draft={draft}
          models={models}
          onCancel={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            reload();
          }}
        />
      )}

      <div className="space-y-3">
        {prompts === null && <Skeleton className="h-32 w-full" />}
        {prompts && list.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/40 px-5 py-8 text-center text-[13px] text-muted-foreground">
            버전이 없습니다.
          </p>
        )}
        {list.map((p) => (
          <PromptCard
            key={p.id}
            prompt={p}
            canEdit={!!me}
            onActivate={() => onActivate(p.id)}
            onFork={() => setDraft({ ...p, name: `${p.name} (수정본)` })}
          />
        ))}
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  canEdit,
  onActivate,
  onFork,
}: {
  prompt: Prompt;
  canEdit: boolean;
  onActivate: () => void;
  onFork: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        prompt.is_active && "border-foreground/30 bg-muted/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">
              v{prompt.version} · {prompt.name}
            </span>
            {prompt.is_active && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-3" /> 활성
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground tabular-nums">
            {prompt.model} · max_tokens {prompt.max_tokens} · temp{" "}
            {prompt.temperature}
            {prompt.created_at
              ? ` · ${new Date(prompt.created_at).toLocaleDateString()}`
              : ""}
          </p>
          {prompt.notes && (
            <p className="mt-1 text-[12px] text-muted-foreground">{prompt.notes}</p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            {!prompt.is_active && (
              <Button size="sm" variant="outline" onClick={onActivate}>
                활성화
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onFork}>
              복제·수정
            </Button>
          </div>
        )}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
      >
        {open ? "프롬프트 숨기기" : "프롬프트 보기"}
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed">
          {prompt.template}
        </pre>
      )}
    </div>
  );
}

function PromptEditor({
  kind,
  draft,
  models,
  onCancel,
  onSaved,
}: {
  kind: Kind;
  draft: Partial<Prompt>;
  models: { models: string[]; default: string };
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(draft.name ?? "");
  const [template, setTemplate] = useState(draft.template ?? "");
  const [model, setModel] = useState(draft.model ?? models.default);
  const [maxTokens, setMaxTokens] = useState(draft.max_tokens ?? 4000);
  const [temperature, setTemperature] = useState(draft.temperature ?? 1.0);
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !template.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createPrompt({
        kind,
        name: name.trim(),
        template,
        model,
        max_tokens: maxTokens,
        temperature,
        notes: notes.trim(),
        activate,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-foreground/30 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium capitalize">새 {kind} 버전</h3>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <Labeled label="이름">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="예: 비유 강화 v2"
          className="block w-full rounded-md border bg-transparent px-3 py-2 text-[14px] focus:border-foreground/40 focus:outline-none"
        />
      </Labeled>

      <Labeled label="프롬프트 템플릿">
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={10}
          placeholder={KIND_DESC[kind]}
          className="block w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-foreground/40 focus:outline-none"
        />
      </Labeled>

      <div className="grid gap-3 sm:grid-cols-3">
        <Labeled label="모델">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="block w-full rounded-md border bg-background px-3 py-2 text-[13px] focus:border-foreground/40 focus:outline-none"
          >
            {models.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="max_tokens">
          <input
            type="number"
            min={256}
            max={16000}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            className="block w-full rounded-md border bg-transparent px-3 py-2 text-[13px] tabular-nums focus:border-foreground/40 focus:outline-none"
          />
        </Labeled>
        <Labeled label="temperature">
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="block w-full rounded-md border bg-transparent px-3 py-2 text-[13px] tabular-nums focus:border-foreground/40 focus:outline-none"
          />
        </Labeled>
      </div>

      <Labeled label="메모 (선택)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="이 버전에서 무엇을 바꿨는지"
          className="block w-full rounded-md border bg-transparent px-3 py-2 text-[14px] focus:border-foreground/40 focus:outline-none"
        />
      </Labeled>

      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <input
          type="checkbox"
          checked={activate}
          onChange={(e) => setActivate(e.target.checked)}
          className="size-4"
        />
        저장 후 이 버전을 활성화 (기본값으로 사용)
      </label>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-[12px] text-destructive">{err}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || !template.trim()}>
            {busy ? "저장 중…" : "버전 저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
