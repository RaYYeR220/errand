// Shared contracts between the orchestrator, the gateway, sandboxd and the web app.

/** Where a placeholder may be substituted inside an outgoing request. */
export type SubstitutionLocation = "header" | "body" | "query";

export interface BrokeredSecret {
  /** Literal token the sandbox sees, e.g. `{{errand:northwind.password}}`. */
  placeholder: string;
  /** Real value. Lives only in the control plane and the gateway process. */
  value: string;
  /** Hosts the value may be sent to. Anything else gets the placeholder blocked. */
  bound_hosts: string[];
  locations: SubstitutionLocation[];
}

export interface CookieBrokering {
  host: string;
  /** Cookie names the site's own JavaScript must be able to read. */
  passthrough: string[];
}

export interface HoldRule {
  id: string;
  label: string;
  host: string;
  method: string;
  /** Matched against the path including the query string. */
  path_regex: string;
}

export interface GatewayRunConfig {
  run_id: string;
  mode: "open" | "strict";
  allow_hosts: string[];
  secrets: BrokeredSecret[];
  cookie_brokering: CookieBrokering[];
  holds: HoldRule[];
  control: { listen: string; events_url?: string; events_file?: string; token: string };
  hold_timeout_s: number;
  /** Development only: permit substitution over plain http. */
  allow_plain_http?: boolean;
}

export type GatewayEventType =
  | "request"
  | "credential.substituted"
  | "credential.exfil_blocked"
  | "secret.scrubbed"
  | "cookie.brokered"
  | "egress.blocked"
  | "action.held"
  | "action.released"
  | "action.rejected";

export interface GatewayEvent {
  run_id: string;
  seq: number;
  ts: string;
  type: GatewayEventType;
  method?: string;
  host?: string;
  path?: string;
  status?: number;
  detail?: Record<string, unknown>;
}

export interface HeldAction {
  hold_id: string;
  rule_id: string;
  label: string;
  content_type?: string;
  body_summary?: unknown;
  body_sha256?: string;
}

// ---- sandboxd ----

export type SandboxKind = "browser" | "compute";

export interface SandboxCreateRequest {
  kind: SandboxKind;
  run_id: string;
  /** Browser sandboxes reach the network only through this proxy. */
  proxy?: { host: string; port: number };
  /** PEM of the gateway CA, installed into the browser trust store. */
  ca_pem?: string;
  cpus: number;
  memory_mb: number;
  timeout_s: number;
}

export interface SandboxIsolation {
  backend: "microsandbox" | "docker";
  kernel: string;
  network_policy: string;
  limits: { cpus: number; memory_mb: number; timeout_s: number };
}

export interface SandboxInfo {
  id: string;
  kind: SandboxKind;
  cdp?: { host: string; port: number };
  isolation: SandboxIsolation;
}

export interface ExecRequest {
  cmd: string[];
  stdin?: string;
  timeout_s: number;
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

// ---- runs ----

export type RunStatus =
  | "queued"
  | "planning"
  | "browsing"
  | "computing"
  | "ordering"
  | "awaiting_approval"
  | "completed"
  | "rejected"
  | "failed";

export interface ErrandRequest {
  task: string;
  budget_usd: number;
  quantity: number;
  deadline_business_days: number;
  ship_to: string;
  suppliers: string[];
  /** Variant host prefix for a test page in front of a supplier, e.g. a containment test case. */
  test_case?: string;
  mode?: "open" | "strict";
}

export type LedgerKind =
  | "run"
  | "plan"
  | "sandbox"
  | "agent"
  | "screen"
  | "gateway"
  | "verify"
  | "compute"
  | "hold"
  | "approval"
  | "receipt";

export interface LedgerEntry {
  seq: number;
  ts: string;
  kind: LedgerKind;
  supplier?: string;
  title: string;
  data?: Record<string, unknown>;
  /** sha256(prev_hash || canonical(entry without hash)). */
  hash: string;
  prev_hash: string;
}

export interface Quote {
  supplier: string;
  product: string;
  sku?: string;
  unit_price_usd: number;
  quantity_available: number;
  lead_time_business_days: number;
  /** Shipping as the page states the rule; the landed-cost step applies it to the ordered quantity. */
  shipping_per_order_usd: number;
  shipping_per_unit_usd: number;
  /** Merchandise subtotal at which shipping becomes free; 0 when there is no such threshold. */
  free_shipping_threshold_usd: number;
  volume_tiers?: { min_qty: number; unit_price_usd: number }[];
  displays?: string;
  external_4k_displays?: number;
  power_delivery_w?: number;
  url: string;
}

export interface Decision {
  /** P(yes) from the decisions model, or null when the check could not run. */
  p: number | null;
  question: string;
}

export interface VerifyResult {
  model: string | null;
  checks: Record<string, Decision>;
  verdict: "pass" | "fail" | "unverified";
}
