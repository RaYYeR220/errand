import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import type { LedgerEntry, LedgerKind } from "@errand/shared";

export const GENESIS = "0".repeat(64);

/** Deterministic JSON: object keys sorted, so the hash of an entry is reproducible anywhere. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function entryHash(prevHash: string, entry: Omit<LedgerEntry, "hash" | "prev_hash">): string {
  return createHash("sha256").update(prevHash).update(canonical(entry)).digest("hex");
}

/** Recompute the chain; returns the index of the first broken entry, or -1 if intact. */
export function verifyChain(entries: LedgerEntry[]): number {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const { hash, prev_hash, ...rest } = e;
    if (prev_hash !== prev || entryHash(prev, rest) !== hash) return i;
    prev = hash;
  }
  return -1;
}

/**
 * Append-only, hash-chained ledger for one run. Each entry is also written to
 * `<dataDir>/runs/<runId>/ledger.jsonl` and broadcast to live subscribers.
 */
export class Ledger extends EventEmitter {
  readonly entries: LedgerEntry[] = [];
  private prev = GENESIS;
  private readonly file: string;

  constructor(readonly runId: string, readonly dir: string, existing?: LedgerEntry[]) {
    super();
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "ledger.jsonl");
    if (existing) {
      // Restored from disk: keep the file as written, continue the chain from its head.
      this.entries.push(...existing);
      this.prev = existing.at(-1)?.hash ?? GENESIS;
    } else {
      writeFileSync(this.file, "");
    }
  }

  append(kind: LedgerKind, title: string, data?: Record<string, unknown>, supplier?: string): LedgerEntry {
    const base = {
      seq: this.entries.length,
      ts: new Date().toISOString(),
      kind,
      title,
      ...(supplier ? { supplier } : {}),
      ...(data ? { data } : {}),
    };
    const hash = entryHash(this.prev, base);
    const entry: LedgerEntry = { ...base, prev_hash: this.prev, hash };
    this.prev = hash;
    this.entries.push(entry);
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
    this.emit("entry", entry);
    return entry;
  }

  get head(): string {
    return this.prev;
  }
}
