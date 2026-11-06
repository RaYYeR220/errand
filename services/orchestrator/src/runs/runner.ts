import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ErrandRequest, Quote, RunStatus, SandboxIsolation, VerifyResult } from "@errand/shared";
import { config } from "../config.js";
import { Ledger } from "./ledger.js";
import { BrowserSession } from "../browser/session.js";
import { OrderHold, type HeldRequest, type HoldDecision } from "../browser/hold.js";
import * as sandboxes from "../sandbox/microsandbox.js";
import { resolveSupplier, supplierDefs, type Supplier } from "../suppliers.js";
import { z } from "zod";
import { runActor } from "../agent/actor.js";
import { plan as makePlan, type Plan } from "../agent/plan.js";
import { verifyQuote, verifyHeldOrder, type OrderIntent } from "../agent/verify.js";
import { computeLandedCost, type ComputeResult } from "../agent/compute.js";

export interface SupplierState {
  id: string;
  name: string;
  platform: string;
  host: string;
  status: "pending" | "browsing" | "done" | "failed";
  isolation?: SandboxIsolation;
  quotes: { quote: Quote; verification: VerifyResult; evidence: string }[];
  frame?: string;
  summary?: string;
}

export interface OrderState {
  supplier: string;
  product: string;
  quantity: number;
  po_number: string;
  expected_total_usd: number;
  status: "browsing" | "held" | "approved" | "rejected" | "placed" | "failed";
  isolation?: SandboxIsolation;
  frame?: string;
  hold?: HeldRequest & { verification?: VerifyResult; screenshot?: string };
  decision?: HoldDecision;
  order_number?: string;
  summary?: string;
}

export interface RunState {
  id: string;
  status: RunStatus;
  request: ErrandRequest & { auto_approve?: boolean };
  created_at: string;
  updated_at: string;
  plan?: Plan;
  plan_model?: string;
  suppliers: SupplierState[];
  compute?: { result: ComputeResult; agrees: boolean; attempts: number; code: string; stdout: string };
  order?: OrderState;
  error?: string;
  ledger_head?: string;
  receipt?: { sha256: string; url?: string };
}

export class Run extends EventEmitter {
  /** Verification per hold id; an approval is only accepted for a hold whose own check finished and did not fail. */
  readonly holdChecks = new Map<string, VerifyResult>();
  readonly dir: string;
  /** Capability for deciding this run's held order; given only to whoever created the run. */
  readonly reviewToken = randomBytes(24).toString("base64url");
  readonly ledger: Ledger;
  readonly abort = new AbortController();
  hold?: OrderHold;

  constructor(readonly state: RunState) {
    super();
    this.dir = path.join(config.dataDir, "runs", state.id);
    mkdirSync(path.join(this.dir, "frames"), { recursive: true });
    this.ledger = new Ledger(state.id, this.dir);
    this.ledger.on("entry", (e) => {
      this.state.ledger_head = e.hash;
      this.emit("entry", e);
    });
  }

  update(patch: Partial<RunState> = {}) {
    Object.assign(this.state, patch, { updated_at: new Date().toISOString() });
    writeFileSync(path.join(this.dir, "state.json"), JSON.stringify(this.state, null, 2));
    this.emit("state", this.state);
  }

  saveFrame(label: string, jpeg: Buffer): string {
    const name = `${label}-${Date.now()}.jpg`;
    writeFileSync(path.join(this.dir, "frames", name), jpeg);
    return `/api/runs/${this.state.id}/frames/${name}`;
  }
}

export const runs = new Map<string, Run>();
const queue: Run[] = [];
let active = 0;

export function newRunId() {
  const t = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `r_${t}_${randomBytes(3).toString("hex")}`;
}

export const DEFAULT_TASK =
  "Order 12 USB-C docking stations for the new hires. Each must drive two 4K monitors and deliver at least 90 W to the laptop. Budget $2,400 all-in, and they must arrive within 3 business days.";

/** One schema for every entry point (HTTP, MCP, eval), enforced inside enqueue. */
export const ErrandInput = z.object({
  task: z.string().min(10).max(2000).default(DEFAULT_TASK),
  quantity: z.number().int().min(1).max(500).default(12),
  budget_usd: z.number().positive().max(100_000).default(2400),
  deadline_business_days: z.number().int().min(1).max(60).default(3),
  ship_to: z.string().min(5).max(300).default("Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105"),
  suppliers: z.array(z.string().max(40)).min(1).max(5).optional(),
  test_case: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  auto_approve: z.boolean().optional(),
});

export function enqueue(input: unknown): Run {
  const parsed = ErrandInput.parse(input ?? {});
  const known = supplierDefs().map((s) => s.id);
  const suppliers = [...new Set(parsed.suppliers ?? known)];
  const unknown = suppliers.filter((s) => !known.includes(s));
  if (unknown.length) throw new z.ZodError([{ code: "custom", path: ["suppliers"], message: `unknown supplier(s): ${unknown.join(", ")}`, input: unknown }]);
  const request: RunState["request"] = { ...parsed, suppliers };
  const id = newRunId();
  const now = new Date().toISOString();
  const run = new Run({ id, status: "queued", request, created_at: now, updated_at: now, suppliers: [] });
  runs.set(id, run);
  run.ledger.append("run", "Errand received", { request: { ...request } });
  run.update();
  queue.push(run);
  pump();
  return run;
}

function pump() {
  while (active < config.limits.maxConcurrentRuns && queue.length) {
    const run = queue.shift()!;
    active++;
    execute(run)
      .catch((e) => {
        run.ledger.append("run", "Errand failed", { error: String(e).slice(0, 500) });
        run.update({ status: "failed", error: String(e).slice(0, 500) });
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function queuePosition(id: string) {
  const i = queue.findIndex((r) => r.state.id === id);
  return i < 0 ? 0 : i + 1;
}

async function execute(run: Run) {
  const req = run.state.request;
  const L = run.ledger;

  // 1. Plan
  run.update({ status: "planning" });
  const { plan, model } = await makePlan(req.task, {
    quantity: req.quantity,
    budget_usd: req.budget_usd,
    deadline_business_days: req.deadline_business_days,
    ship_to: req.ship_to,
  });
  L.append("plan", "Requirements extracted", { model, requirements: plan.requirements, selection_rule: plan.selection_rule });
  run.update({ plan, plan_model: model });

  // 2. Visit every supplier in parallel, each in its own microVM.
  const suppliers = req.suppliers.map((id) => resolveSupplier(id, req.test_case));
  run.update({
    status: "browsing",
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, platform: s.platform, host: s.host, status: "pending", quotes: [] })),
  });
  await Promise.all(suppliers.map((s, i) => visitSupplier(run, s, i, plan)));

  const quotes = run.state.suppliers.flatMap((s) => s.quotes.filter((q) => q.verification.verdict !== "fail").map((q) => q.quote));
  if (!quotes.length) throw new Error("no verified quotes were collected");

  // 3. Compare in a no-network microVM (Pattern A).
  run.update({ status: "computing" });
  const compute = await computeLandedCost({ runId: run.state.id, quotes, requirements: plan.requirements, ledger: L });
  run.update({ compute: { result: compute.result, agrees: compute.agrees, attempts: compute.attempts, code: compute.code, stdout: compute.stdout } });
  const winner = compute.result.winner;
  if (!winner) {
    L.append("run", "No supplier meets every requirement — nothing to order");
    return finish(run, "completed");
  }

  // 4. Order from the winner; the order request is held until verified and approved.
  const supplier = suppliers.find((s) => s.id === winner.supplier)!;
  await placeOrder(run, supplier, plan, winner.product, winner.total_usd);
  return finish(run, run.state.order?.status === "placed" ? "completed" : run.state.order?.status === "rejected" ? "rejected" : "failed");
}

function secretsFor(s: Supplier) {
  if (!s.password) throw new Error(`no credential configured for ${s.id} (${s.account.password_env})`);
  return [{ name: `${s.id}.password`, value: s.password, allowHosts: [s.host] }];
}

async function visitSupplier(run: Run, s: Supplier, index: number, plan: Plan) {
  const L = run.ledger;
  const st = run.state.suppliers[index]!;
  st.status = "browsing";
  run.update();
  let box: sandboxes.BrowserSandbox | undefined;
  let session: BrowserSession | undefined;
  try {
    box = await sandboxes.createBrowserSandbox({ runId: run.state.id, label: s.id, secrets: secretsFor(s), memoryMb: config.limits.browserMemoryMb });
    st.isolation = box.isolation;
    L.append("sandbox", `Browser microVM started for ${s.name}`, { sandbox: box.id, isolation: box.isolation, credential: `${s.id}.password bound to ${s.host}` }, s.id);
    run.update();
    session = await BrowserSession.connect(box.cdp);
    const outcome = await runActor(
      {
        supplierId: s.id,
        supplierName: s.name,
        startUrl: s.login_url,
        credentials: { username: s.account.username, passwordToken: box.placeholders[`${s.id}.password`]! },
        goal: plan.supplier_goal,
        ledger: L,
        signal: run.abort.signal,
        onFrame: (jpeg) => {
          st.frame = run.saveFrame(s.id, jpeg);
          run.update();
        },
        onQuote: async (quote, evidence) => {
          const evidenceUrl = run.saveFrame(`${s.id}-quote`, evidence);
          const text = await session!.visibleText().catch(() => "");
          const verification = await verifyQuote(quote, evidence, text);
          st.quotes.push({ quote, verification, evidence: evidenceUrl });
          L.append("verify", `Quote ${verification.verdict}: ${quote.product} @ $${quote.unit_price_usd}`, { quote, verification, evidence: evidenceUrl }, s.id);
          run.update();
        },
      },
      session,
    );
    st.status = outcome.status === "done" ? "done" : st.quotes.length ? "done" : "failed";
    st.summary = outcome.summary;
  } catch (e) {
    st.status = "failed";
    st.summary = String(e).slice(0, 300);
    L.append("agent", `Supplier visit failed: ${st.summary}`, undefined, s.id);
  } finally {
    await session?.close();
    if (box) {
      await sandboxes.destroy(box.id);
      L.append("sandbox", `Browser microVM destroyed for ${s.name}`, { sandbox: box.id }, s.id);
    }
    run.update();
  }
}

async function placeOrder(run: Run, s: Supplier, plan: Plan, product: string, expectedTotal: number) {
  const L = run.ledger;
  const req = plan.requirements;
  const po = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const order: OrderState = { supplier: s.id, product, quantity: req.quantity, po_number: po, expected_total_usd: expectedTotal, status: "browsing" };
  run.update({ status: "ordering", order });

  const intent: OrderIntent = { product, quantity: req.quantity, ship_to: req.ship_to, budget_usd: req.budget_usd, po_number: po, expected_total_usd: expectedTotal, supplier: s.name };
  L.append("run", `Ordering ${req.quantity} × ${product} from ${s.name}`, { intent }, s.id);

  let box: sandboxes.BrowserSandbox | undefined;
  let session: BrowserSession | undefined;
  try {
    box = await sandboxes.createBrowserSandbox({ runId: run.state.id, label: `${s.id}-order`, secrets: secretsFor(s), memoryMb: config.limits.browserMemoryMb });
    order.isolation = box.isolation;
    L.append("sandbox", `Order microVM started for ${s.name}`, { sandbox: box.id, isolation: box.isolation }, s.id);
    session = await BrowserSession.connect(box.cdp);
    const sess = session;

    const hold = new OrderHold(
      sess.context,
      s.order_request.map((r, i) => ({ id: `${s.id}.order.${i}`, label: "Place order", host: s.host, method: r.method, pathRegex: r.path_regex })),
      (held) => void onHeld(run, sess, held, intent),
      (held, d) => {
        order.decision = d;
        order.status = d.decision === "approve" ? "approved" : "rejected";
        L.append("approval", d.decision === "approve" ? `Released by ${d.by}` : `Rejected by ${d.by}: ${d.reason}`, { hold_id: held.hold_id, decision: d }, s.id);
        run.update({ status: "ordering" });
      },
      config.hold.timeoutS * 1000,
      { host: s.host, safe: s.safe_requests ?? [] },
    );
    run.hold = hold;
    await hold.arm();
    L.append("hold", "Order placement request is held until verified and approved", { rules: s.order_request }, s.id);

    const outcome = await runActor(
      {
        supplierId: s.id,
        supplierName: s.name,
        startUrl: s.login_url,
        credentials: { username: s.account.username, passwordToken: box.placeholders[`${s.id}.password`]! },
        goal:
          `Sign in, add exactly ${req.quantity} of "${product}" to the cart, and check out: PO number ${po}, cost center IT-OPS-204, ` +
          `ship to ${req.ship_to}, payment by invoice / pay on account. Then place the order. ` +
          `After the order is placed, read the order number from the confirmation and call done with it. If the order is refused, call fail with the message shown.`,
        ledger: L,
        signal: run.abort.signal,
        maxSteps: config.limits.actorMaxSteps + 10,
        onFrame: (jpeg) => {
          order.frame = run.saveFrame(`${s.id}-order`, jpeg);
          run.update();
        },
        afterAction: async () => {
          // While a request is held, the agent waits for the decision.
          while (hold.pendingHolds().length) await new Promise((r) => setTimeout(r, 500));
          return run.abort.signal.aborted ? "stop" : "continue";
        },
      },
      sess,
    );
    order.summary = outcome.summary;
    if (outcome.status === "done" && order.status === "approved") {
      order.status = "placed";
      order.order_number = String(outcome.result?.order_number ?? "") || undefined;
      L.append("run", `Order placed${order.order_number ? ` — ${order.order_number}` : ""}`, { order_number: order.order_number }, s.id);
    } else if (order.status !== "rejected") {
      order.status = "failed";
    }
  } finally {
    await run.hold?.disarm();
    await session?.close();
    if (box) {
      await sandboxes.destroy(box.id);
      L.append("sandbox", `Order microVM destroyed`, { sandbox: box.id }, s.id);
    }
    run.update();
  }
}

async function onHeld(run: Run, session: BrowserSession, held: HeldRequest, intent: OrderIntent) {
  const L = run.ledger;
  const order = run.state.order!;
  order.status = "held";
  order.hold = { ...held };
  L.append("hold", "Place order HELD — nothing has been sent to the supplier", { hold_id: held.hold_id, method: held.method, url: held.url, body: held.body_summary, body_sha256: held.body_sha256 }, order.supplier);
  run.update({ status: "awaiting_approval" });

  const shot = await session.screenshot({ quality: 80 }).catch(() => Buffer.alloc(0));
  const text = await session.visibleText().catch(() => "");
  order.hold.screenshot = run.saveFrame(`${order.supplier}-held`, shot);
  const verification = await verifyHeldOrder(intent, held, shot, text);
  run.holdChecks.set(held.hold_id, verification);
  if (order.hold?.hold_id === held.hold_id) order.hold.verification = verification;
  L.append("verify", `Held order check: ${verification.verdict}`, { verification }, order.supplier);
  run.update();

  if (verification.verdict === "fail") {
    // The verifier can veto; it can never approve on its own.
    const failed = Object.entries(verification.checks).filter(([, c]) => c.p !== null && c.p < 0.5).map(([k]) => k);
    run.hold?.decide(held.hold_id, { decision: "reject", reason: `Order does not match the approved intent (${failed.join(", ")}).`, by: "verifier" });
    return;
  }
  if (run.state.request.auto_approve && verification.verdict === "pass") {
    run.hold?.decide(held.hold_id, { decision: "approve", reason: "auto-approve (evaluation run) after a passing check", by: "auto" });
  }
}

export function checkReviewToken(run: Run, token: string | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(run.reviewToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decideHold(runId: string, holdId: string, d: HoldDecision): { ok: boolean; error?: string } {
  const run = runs.get(runId);
  if (!run?.hold) return { ok: false, error: "no pending hold" };
  if (d.decision === "approve" && d.by === "reviewer") {
    const check = run.holdChecks.get(holdId);
    if (!check) return { ok: false, error: "the order check for this hold is still running" };
    if (check.verdict === "fail") return { ok: false, error: "this hold failed verification and cannot be approved" };
  }
  return run.hold.decide(holdId, d) ? { ok: true } : { ok: false, error: "no pending hold with that id" };
}

function finish(run: Run, status: RunStatus) {
  const receipt = {
    run_id: run.state.id,
    status,
    request: run.state.request,
    order: run.state.order ? { ...run.state.order, hold: run.state.order.hold ? { ...run.state.order.hold } : undefined } : undefined,
    ledger_head: run.ledger.head,
    ledger_entries: run.ledger.entries.length,
    finished_at: new Date().toISOString(),
  };
  const body = JSON.stringify(receipt, null, 2);
  writeFileSync(path.join(run.dir, "receipt.json"), body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  run.ledger.append("receipt", `Receipt sealed (${run.ledger.entries.length} ledger entries)`, { sha256, ledger_head: run.ledger.head });
  run.update({ status, receipt: { sha256 } });
}
