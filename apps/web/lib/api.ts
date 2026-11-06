"use client";
import { useEffect, useRef, useState } from "react";
import type { LedgerEntry } from "@errand/shared";

export type RunState = any; // mirrors the orchestrator's RunState; kept loose on the client on purpose

export async function startErrand(body: Record<string, unknown> = {}) {
  const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as { id: string; status: string; queue_position: number; review_token: string };
}

export async function decide(runId: string, holdId: string, decision: "approve" | "reject", reviewToken: string, reason = "") {
  const res = await fetch(`/api/runs/${runId}/holds/${holdId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-token": reviewToken },
    body: JSON.stringify({ decision, reason }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Live run state + ledger over server-sent events. */
export function useRun(id: string | undefined) {
  const [state, setState] = useState<RunState | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    if (!id) return;
    seen.current = new Set();
    setEntries([]);
    const es = new EventSource(`/api/runs/${id}/events`);
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("entry", (e) => {
      const entry = JSON.parse((e as MessageEvent).data) as LedgerEntry;
      if (seen.current.has(entry.seq)) return;
      seen.current.add(entry.seq);
      setEntries((prev) => [...prev, entry]);
    });
    return () => es.close();
  }, [id]);
  return { state, entries, connected };
}

const TOKENS_KEY = "errand.review-tokens";
export function rememberReviewToken(runId: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}");
    all[runId] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the token still lives in the URL fragment */
  }
}
export function reviewTokenFor(runId: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("review");
  if (fromHash) return fromHash;
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}")[runId];
  } catch {
    return undefined;
  }
}
