import { createHash, randomUUID } from "node:crypto";
import type { BrowserContext, Route, Request } from "playwright-core";

export interface HoldRuleSpec {
  id: string;
  label: string;
  host: string;
  method: string;
  /** Matched against path + query. */
  pathRegex: string;
}

export interface HeldRequest {
  hold_id: string;
  rule_id: string;
  label: string;
  method: string;
  url: string;
  content_type?: string;
  body_summary: unknown;
  body_sha256?: string;
  held_at: string;
}

export type HoldDecision = { decision: "approve" | "reject"; reason: string; by: string };

const REJECT_PAGE = (label: string, reason: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Held by Errand</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#f4f3ef;color:#1d1c19;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:32px;border:1px solid #dcd9d0;background:#fff;border-radius:10px}h1{font-size:20px;margin:0 0 8px}</style></head>
<body><main><h1>${escapeHtml(label)} was not released</h1><p>${escapeHtml(reason)}</p><p>This request was held by Errand and never reached the supplier.</p></main></body></html>`;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Parse a request body into something a reviewer can read; placeholder tokens are left as-is. */
export function summarizeBody(req: Request): { content_type?: string; summary: unknown; sha256?: string } {
  const contentType = req.headers()["content-type"];
  const raw = req.postDataBuffer();
  if (!raw) return { content_type: contentType, summary: null };
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const text = raw.toString("utf8");
  try {
    if (contentType?.includes("application/json")) return { content_type: contentType, summary: JSON.parse(text), sha256 };
    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of new URLSearchParams(text)) {
        const prev = out[k];
        out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
      }
      return { content_type: contentType, summary: out, sha256 };
    }
  } catch {
    /* fall through to raw text */
  }
  return { content_type: contentType, summary: text.slice(0, 4000), sha256 };
}

/**
 * Holds the supplier's order-placement request at the browser's network layer (CDP Fetch domain),
 * driven from the control plane. The model can click "Place order" whenever it likes; the request
 * does not leave the browser until `decide()` approves it. Anything else is released untouched.
 * Timeouts and internal errors reject (fail closed).
 */
export class OrderHold {
  private readonly pending = new Map<string, { route: Route; held: HeldRequest; resolve: (d: HoldDecision) => void }>();
  private armed = false;
  private handler?: (route: Route) => Promise<void>;

  constructor(
    private readonly context: BrowserContext,
    private readonly rules: HoldRuleSpec[],
    private readonly onHeld: (held: HeldRequest) => void,
    private readonly onResolved: (held: HeldRequest, d: HoldDecision) => void,
    private readonly timeoutMs = 10 * 60_000,
  ) {}

  match(req: Request): HoldRuleSpec | undefined {
    const url = new URL(req.url());
    const pathAndQuery = url.pathname + url.search;
    return this.rules.find(
      (r) => r.method.toUpperCase() === req.method().toUpperCase() && url.host === r.host && new RegExp(r.pathRegex).test(pathAndQuery),
    );
  }

  async arm() {
    if (this.armed) return;
    this.armed = true;
    this.handler = async (route: Route) => {
      const req = route.request();
      let rule: HoldRuleSpec | undefined;
      try {
        rule = this.match(req);
      } catch {
        rule = undefined;
      }
      if (!rule) return route.fallback();
      const body = summarizeBody(req);
      const held: HeldRequest = {
        hold_id: randomUUID(),
        rule_id: rule.id,
        label: rule.label,
        method: req.method(),
        url: req.url(),
        content_type: body.content_type,
        body_summary: body.summary,
        body_sha256: body.sha256,
        held_at: new Date().toISOString(),
      };
      const decision = await new Promise<HoldDecision>((resolve) => {
        const timer = setTimeout(() => resolve({ decision: "reject", reason: "No decision before the hold timed out.", by: "timeout" }), this.timeoutMs);
        this.pending.set(held.hold_id, {
          route,
          held,
          resolve: (d) => {
            clearTimeout(timer);
            resolve(d);
          },
        });
        try {
          this.onHeld(held);
        } catch {
          resolve({ decision: "reject", reason: "The hold could not be registered.", by: "system" });
        }
      });
      this.pending.delete(held.hold_id);
      this.onResolved(held, decision);
      if (decision.decision === "approve") {
        await route.continue().catch(() => {});
      } else {
        await route.fulfill({ status: 403, contentType: "text/html; charset=utf-8", body: REJECT_PAGE(rule.label, decision.reason) }).catch(() => {});
      }
    };
    await this.context.route("**/*", this.handler);
  }

  decide(holdId: string, decision: HoldDecision): boolean {
    const p = this.pending.get(holdId);
    if (!p) return false;
    p.resolve(decision);
    return true;
  }

  pendingHolds(): HeldRequest[] {
    return [...this.pending.values()].map((p) => p.held);
  }

  async disarm() {
    for (const p of this.pending.values()) p.resolve({ decision: "reject", reason: "The errand ended before a decision.", by: "system" });
    if (this.handler) await this.context.unroute("**/*", this.handler).catch(() => {});
    this.armed = false;
  }
}
