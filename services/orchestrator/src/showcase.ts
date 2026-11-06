import type { LedgerEntry } from "@errand/shared";
import { verifyChain } from "./runs/ledger.js";
import { runs, type Run } from "./runs/runner.js";

export interface ShowcaseStep {
  label: string;
  short: string;
  detail: string;
  seq: number;
  hash: string;
  prev_hash: string;
  held?: boolean;
}

const money = (n: unknown) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "");

/**
 * The milestones of one real, finished errand, each pinned to the actual ledger entry (and hash)
 * it came from. The landing page draws this chain; nothing in it is typed by hand.
 */
export function showcase(): { run_id: string; head: string; intact: boolean; entries: number; steps: ShowcaseStep[] } | null {
  const done = [...runs.values()]
    .filter((r) => r.state.status === "completed" && r.state.order?.status === "placed")
    .sort((a, b) => (a.state.updated_at < b.state.updated_at ? 1 : -1));
  const run: Run | undefined = done[0];
  if (!run) return null;
  const E = run.ledger.entries;
  const last = (pred: (e: LedgerEntry) => boolean) => [...E].reverse().find(pred);
  const first = (pred: (e: LedgerEntry) => boolean) => E.find(pred);
  const steps: ShowcaseStep[] = [];
  const add = (e: LedgerEntry | undefined, label: string, short: string, detail: string, held = false) => {
    if (!e || steps.some((s) => s.seq === e.seq)) return;
    steps.push({ label, short, detail, seq: e.seq, hash: e.hash, prev_hash: e.prev_hash, ...(held ? { held } : {}) });
  };
  const req = run.state.request;
  add(first((e) => e.kind === "run"), "Request received", "Request", `${req.quantity} units · ≤ ${money(req.budget_usd)} · ≤ ${req.deadline_business_days} business days`);
  add(first((e) => e.kind === "plan"), "Requirements extracted", "Plan", "planner on Vultr Serverless Inference");
  for (const s of run.state.suppliers) {
    add(first((e) => e.kind === "sandbox" && e.supplier === s.id && /started/.test(e.title)), `microVM up · ${s.id}`, `microVM · ${s.id}`, "own kernel · CPU, memory and time capped");
    const v = last((e) => e.kind === "verify" && e.supplier === s.id && /^Quote/.test(e.title));
    add(v, `Offers read · ${s.name}`, `${s.quotes.length} offers · ${s.id}`, "signed in with a placeholder; each offer checked against its page");
  }
  const compute = run.state.compute;
  add(
    last((e) => e.kind === "compute" && /control-plane check/.test(e.title)),
    "Landed cost computed",
    "Landed cost",
    compute?.result.winner ? `${compute.result.winner.product} · ${money(compute.result.winner.total_usd)}` : "code ran in a microVM with no network",
  );
  add(first((e) => e.kind === "sandbox" && /Order microVM started/.test(e.title)), "Order microVM up", "Order microVM", "a fresh microVM signs in again");
  add(first((e) => e.kind === "hold" && /HELD/.test(e.title)), "Place order held", "Order held", "the request stopped before it left the browser", true);
  add(last((e) => e.kind === "verify" && /Held order/.test(e.title)), "Order checked", "Checked", "item · quantity · ship-to · PO read by clef; budget computed");
  add(last((e) => e.kind === "approval"), "Released by the reviewer", "Approved", "a person released the held request");
  const o = run.state.order;
  add(last((e) => e.kind === "run" && /Order placed/.test(e.title)), `Order placed${o?.order_number ? ` · ${o.order_number}` : ""}`, "Placed", `${o?.quantity} × ${o?.product}`);
  add(last((e) => e.kind === "sandbox" && /destroyed/.test(e.title)), "microVMs destroyed", "VMs destroyed", "browsers and sessions gone");
  add(last((e) => e.kind === "receipt"), "Receipt sealed", "Sealed", `${E.length} ledger entries`);
  steps.sort((a, b) => a.seq - b.seq);
  return { run_id: run.state.id, head: run.ledger.head, intact: verifyChain(E) === -1, entries: E.length, steps };
}
