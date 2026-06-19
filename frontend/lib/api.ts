"use client";

/**
 * Browser-side API helpers. All calls hit /api/* on this same origin;
 * the nginx in front of us proxies that to the backend.
 */

import { tracked } from "./warming";

export type Prompt = {
  id: string;
  kind: "generator" | "evaluator";
  version: number;
  name: string;
  template: string;
  model: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  notes: string;
  created_at: string | null;
};

export type Evaluation = {
  winner: "A" | "B";
  reason: string;
  critique_a: string;
  critique_b: string;
};

export type Feedback = {
  choice: "A" | "B";
  reason: string;
  understanding: string;
};

export type SessionDetail = {
  id: string;
  spec: string;
  audience: string;
  status: string;
  error: string;
  created_at: string | null;
  candidate_a: string;
  candidate_b: string;
  generator: Prompt | null;
  evaluator: Prompt | null;
  evaluation: Evaluation | null;
  feedback: Feedback | null;
  agreement: boolean | null;
};

export type SessionSummary = {
  id: string;
  spec: string;
  audience: string;
  status: string;
  has_evaluation: boolean;
  has_feedback: boolean;
  agreement: boolean | null;
  created_at: string | null;
};

export type Stats = {
  total_sessions: number;
  evaluated: number;
  feedbacks: number;
  labeled_pairs: number;
  agreements: number;
  agreement_rate: number | null;
};

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let detail = `요청 실패 (${r.status})`;
    try {
      const j = await r.json();
      if (j?.detail)
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* non-JSON */
    }
    throw new Error(detail);
  }
  return r.json();
}

const GET = { credentials: "include" as const };
const POST = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ---- prompts (models) ----

export async function fetchPrompts(): Promise<Record<string, Prompt[]>> {
  return tracked(async () => jsonOrThrow(await fetch("/api/prompts", GET)));
}

export async function fetchModels(): Promise<{ models: string[]; default: string }> {
  return tracked(async () => jsonOrThrow(await fetch("/api/prompts/models", GET)));
}

export async function createPrompt(input: {
  kind: "generator" | "evaluator";
  name: string;
  template: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  notes?: string;
  activate?: boolean;
}): Promise<Prompt> {
  return tracked(async () =>
    jsonOrThrow(await fetch("/api/prompts", POST(input)))
  );
}

export async function activatePrompt(id: string): Promise<Prompt> {
  return tracked(async () =>
    jsonOrThrow(await fetch(`/api/prompts/${id}/activate`, POST()))
  );
}

// ---- sessions ----

export async function createSession(input: {
  spec: string;
  audience?: string;
  generator_prompt_id?: string;
  evaluator_prompt_id?: string;
}): Promise<SessionDetail> {
  return tracked(async () =>
    jsonOrThrow(await fetch("/api/sessions", POST(input)))
  );
}

export async function fetchSession(id: string): Promise<SessionDetail> {
  return tracked(async () => jsonOrThrow(await fetch(`/api/sessions/${id}`, GET)));
}

export async function evaluateSession(id: string): Promise<SessionDetail> {
  return tracked(async () =>
    jsonOrThrow(await fetch(`/api/sessions/${id}/evaluate`, POST()))
  );
}

export async function submitFeedback(
  id: string,
  input: { choice: "A" | "B"; reason: string; understanding: string }
): Promise<SessionDetail> {
  return tracked(async () =>
    jsonOrThrow(await fetch(`/api/sessions/${id}/feedback`, POST(input)))
  );
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  return tracked(async () => jsonOrThrow(await fetch("/api/sessions", GET)));
}

export async function fetchStats(): Promise<Stats> {
  return tracked(async () => jsonOrThrow(await fetch("/api/stats", GET)));
}
