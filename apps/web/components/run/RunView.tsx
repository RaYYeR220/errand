"use client";

import { useEffect, useMemo, useState } from "react";
import type { LedgerEntry } from "@errand/shared";
import { decide, reviewTokenFor, useRun } from "@/lib/api";

const money = (n: number | undefined | null) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const pct = (p: number | null | undefined) => (typeof p === "number" ? `${Math.round(p * 100)}%` : "n/a");

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  planning: "Planning",
  browsing: "Signing in to suppliers",
  computing: "Computing landed cost",
  ordering: "Placing the order",
  awaiting_approval: "Order held — waiting for you",
  completed: "Completed",
  rejected: "Order rejected",
  failed: "Failed",
};

export function RunView({ id }: { id: string }) {
  const { state, entries, connected } = useRun(id);
  const [token, setToken] = useState<string | undefined>();
  useEffect(() => setToken(reviewTokenFor(id)), [id]);

  if (!state) {
    return <div className="run-empty">Connecting to errand {id}…</div>;
  }

  return (
    <div className="run">
      <header className="run-head">
        <div>
          <p className="eyebrow">Errand {state.id}</p>
          <h1 className="run-title">{state.request?.task}</h1>
          <p className="run-meta">
            {state.request?.quantity} units · budget {money(state.request?.budget_usd)} · within {state.request?.deadline_business_days} business days · ship to {state.request?.ship_to}
          </p>
        </div>
        <div className={`run-status s-${state.status}`}>
          <span className="dot" aria-hidden />
          {STATUS_LABEL[state.status] ?? state.status}
          {!connected && <span className="muted"> · reconnecting</span>}
        </div>
      </header>

      {state.order?.hold && state.order.status === "held" && (
        <HoldCard runId={state.id} order={state.order} token={token} />
      )}

      <section className="suppliers">
        {state.suppliers?.map((s: any) => (
          <SupplierPanel key={s.id} s={s} />
        ))}
      </section>

      {state.compute && <ComputePanel compute={state.compute} />}

      {state.order && <OrderPanel order={state.order} />}

      <LedgerPanel entries={entries} head={state.ledger_head} receipt={state.receipt} runId={state.id} />
    </div>
  );
}

function SupplierPanel({ s }: { s: any }) {
  return (
    <article className="panel supplier">
      <div className="panel-head">
        <div>
          <h2>{s.name}</h2>
          <p className="muted">
            {s.platform} · {s.host}
          </p>
        </div>
        <span className={`chip c-${s.status}`}>{s.status}</span>
      </div>
      <div className="frame">
        {s.frame ? <img src={s.frame} alt={`Live view of the browser on ${s.name}`} /> : <div className="frame-empty">Starting microVM…</div>}
      </div>
      {s.isolation && <Isolation iso={s.isolation} credential={`${s.id}.password`} host={s.host} />}
      {s.probe && (
        <div className={`probe ${s.probe.refused ? "ok" : "warn"}`}>
          <p className="eyebrow">Containment probe</p>
          <p>
            This browser sent its credential <code>{s.probe.sent}</code> to <code>{s.probe.host}</code>, a host it is not bound to.{" "}
            {s.probe.refused ? <b>The sandbox runtime refused the request.</b> : <b>The request was not refused.</b>}
          </p>
          <pre className="body">{s.probe.response}</pre>
        </div>
      )}
      {s.quotes?.length > 0 && (
        <table className="quotes">
          <thead>
            <tr>
              <th>Product</th>
              <th>Unit</th>
              <th>Stock</th>
              <th>Lead</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {s.quotes.map((q: any, i: number) => (
              <tr key={i}>
                <td>
                  <a href={q.evidence} target="_blank" rel="noreferrer">
                    {q.quote.product}
                  </a>
                </td>
                <td>{money(q.quote.unit_price_usd)}</td>
                <td>{q.quote.quantity_available}</td>
                <td>{q.quote.lead_time_business_days}d</td>
                <td>
                  <Verdict v={q.verification} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.summary && <p className="muted small">{s.summary}</p>}
    </article>
  );
}

function Isolation({ iso, credential, host }: { iso: any; credential: string; host: string }) {
  return (
    <dl className="iso">
      <div>
        <dt>Sandbox</dt>
        <dd>
          {iso.backend} microVM · {iso.kernel}
        </dd>
      </div>
      <div>
        <dt>Limits</dt>
        <dd>
          {iso.limits.cpus} vCPU · {iso.limits.memory_mb} MiB · {Math.round(iso.limits.timeout_s / 60)} min
        </dd>
      </div>
      <div>
        <dt>Credential</dt>
        <dd>
          placeholder only; real value released to <code>{host}</code>
        </dd>
      </div>
    </dl>
  );
}

function Verdict({ v }: { v: any }) {
  if (!v) return null;
  const title = Object.entries(v.checks ?? {})
    .map(([k, c]: any) => `${k}: ${pct(c.p)}`)
    .join("\n");
  return (
    <span className={`verdict v-${v.verdict}`} title={title}>
      {v.verdict}
    </span>
  );
}

function ComputePanel({ compute }: { compute: any }) {
  const rows = [...(compute.result?.candidates ?? [])].sort((a: any, b: any) => Number(b.eligible) - Number(a.eligible) || a.total_usd - b.total_usd);
  const winner = compute.result?.winner;
  return (
    <section className="panel compute">
      <div className="panel-head">
        <div>
          <h2>Landed cost</h2>
          <p className="muted">
            Code written by the model, run in a microVM with no network{compute.attempts > 1 ? ` (${compute.attempts} attempts)` : ""}; re-checked by the control plane: {compute.agrees ? "agrees" : "disagreed — control-plane answer used"}.
          </p>
        </div>
      </div>
      <table className="landed">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Product</th>
            <th>Unit</th>
            <th>Shipping</th>
            <th>Total</th>
            <th>Lead</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c: any, i: number) => (
            <tr key={i} className={winner && c.supplier === winner.supplier && c.product === winner.product ? "win" : c.eligible ? "" : "out"}>
              <td>{c.supplier}</td>
              <td>{c.product}</td>
              <td>{money(c.unit_price_usd)}</td>
              <td>{money(c.shipping_usd)}</td>
              <td>{money(c.total_usd)}</td>
              <td>{c.lead_time_business_days}d</td>
              <td>{c.eligible ? (winner && c.supplier === winner.supplier && c.product === winner.product ? "Selected" : "Eligible") : c.reasons.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compute.code && (
        <details>
          <summary>Code that ran in the sandbox</summary>
          <pre>{compute.code}</pre>
        </details>
      )}
    </section>
  );
}

function HoldCard({ runId, order, token }: { runId: string; order: any; token?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = order.hold;
  const v = hold.verification;
  const act = async (d: "approve" | "reject") => {
    if (!token) return setError("Only the person who started this errand can decide its order.");
    setBusy(true);
    setError(null);
    try {
      await decide(runId, hold.hold_id, d, token);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel hold" aria-live="polite">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Held before it left the browser</p>
          <h2>
            {order.quantity} × {order.product} from {order.supplier}
          </h2>
          <p className="muted">
            PO {order.po_number} · expected {money(order.expected_total_usd)} · {hold.method} {new URL(hold.url).pathname}
          </p>
        </div>
      </div>
      <div className="hold-grid">
        {hold.screenshot && <img className="hold-shot" src={hold.screenshot} alt="Checkout page at the moment the order was held" />}
        <div>
          <h3>Order check {v ? `(${v.model ?? "unavailable"})` : "(running…)"}</h3>
          {v ? (
            <ul className="checks">
              {Object.entries(v.checks).map(([k, c]: any) => (
                <li key={k} className={c.p === null ? "na" : c.p >= 0.85 ? "ok" : c.p < 0.5 ? "bad" : "warn"}>
                  <span>{c.question}</span>
                  <b>{pct(c.p)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Checking the held request against the approved intent…</p>
          )}
          <h3>Request body as held</h3>
          <pre className="body">
            {hold.body_summary === null || hold.body_summary === undefined
              ? "(no body — the supplier places the order from the signed-in cart; nothing in this request carries a credential)"
              : JSON.stringify(hold.body_summary, null, 2)}
          </pre>
          <div className="actions">
            <button className="btn primary" disabled={busy || !v || v.verdict === "fail"} onClick={() => act("approve")}>
              Approve and release
            </button>
            <button className="btn" disabled={busy} onClick={() => act("reject")}>
              Reject
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function OrderPanel({ order }: { order: any }) {
  return (
    <section className="panel order">
      <div className="panel-head">
        <div>
          <h2>Order</h2>
          <p className="muted">
            {order.quantity} × {order.product} · {order.supplier} · PO {order.po_number}
          </p>
        </div>
        <span className={`chip c-${order.status}`}>{order.status}</span>
      </div>
      <div className="frame">{order.frame ? <img src={order.frame} alt="Live view of the ordering browser" /> : <div className="frame-empty">Starting microVM…</div>}</div>
      {order.order_number && (
        <p>
          Supplier order number <b>{order.order_number}</b>
        </p>
      )}
      {order.decision && (
        <p className="muted">
          {order.decision.decision === "approve" ? "Released" : "Rejected"} by {order.decision.by}: {order.decision.reason}
        </p>
      )}
    </section>
  );
}

function LedgerPanel({ entries, head, receipt, runId }: { entries: LedgerEntry[]; head?: string; receipt?: any; runId: string }) {
  const shown = useMemo(() => [...entries].reverse().slice(0, 120), [entries]);
  return (
    <section className="panel ledger">
      <div className="panel-head">
        <div>
          <h2>Ledger</h2>
          <p className="muted">
            Every step, hash-chained. Head <code>{head?.slice(0, 16)}…</code>
            {receipt && (
              <>
                {" "}
                · receipt <a href={`/api/runs/${runId}/receipt`}>{receipt.sha256.slice(0, 12)}…</a>
              </>
            )}{" "}
            · <a href={`/api/runs/${runId}/ledger`}>verify chain</a>
          </p>
        </div>
      </div>
      <ol className="entries">
        {shown.map((e) => (
          <li key={e.seq} className={`k-${e.kind}`}>
            <span className="seq">{e.seq}</span>
            <span className="kind">{e.kind}</span>
            <span className="sup">{e.supplier ?? ""}</span>
            <span className="title">{e.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
