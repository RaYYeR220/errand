import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Sandbox, NetworkPolicy, Destination } from "microsandbox";
import type { ExecResult, SandboxIsolation } from "@errand/shared";

/**
 * Sandboxes are Microsandbox microVMs (libkrun over KVM on Linux / Windows Hypervisor Platform locally):
 * each one has its own kernel, its own resource caps, and is destroyed when its task ends.
 *
 * Browser sandboxes receive credentials only as placeholders. The real value is registered with
 * Microsandbox as a destination-bound secret: it is substituted outside the guest, and only on
 * requests to the hosts it is bound to. Anything else carrying the placeholder is refused by the
 * sandbox runtime with `secret_policy_denied`.
 */

export interface SecretBinding {
  /** Logical name, e.g. `northwind.password`. */
  name: string;
  value: string;
  allowHosts: string[];
}

export interface BrowserSandbox {
  id: string;
  name: string;
  cdp: { host: string; port: number };
  /** name → placeholder token the agent may type. */
  placeholders: Record<string, string>;
  isolation: SandboxIsolation;
}

export interface ComputeSandbox {
  id: string;
  name: string;
  isolation: SandboxIsolation;
}

const BROWSER_IMAGE = process.env.BROWSER_IMAGE ?? "chromedp/headless-shell:latest";
const COMPUTE_IMAGE = process.env.COMPUTE_IMAGE ?? "python:3.12-slim";
const MSB_HOME = process.env.MSB_HOME ?? path.join(os.homedir(), ".microsandbox");

/**
 * Local development only: the stores run on the machine that hosts the sandboxes, under public
 * wildcard DNS that answers with the sandbox gateway address (e.g. acme.172-16-0-5.sslip.io), and
 * their certificates come from a local CA. Production suppliers are public hosts and need neither.
 */
const DEV_HOST_IP = process.env.SANDBOX_DEV_HOST_IP;
if (DEV_HOST_IP) {
  if (process.env.NODE_ENV === "production") throw new Error("SANDBOX_DEV_HOST_IP is a local development setting and is refused in production");
  if (!/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(DEV_HOST_IP) || DEV_HOST_IP.split(".").length !== 4) {
    throw new Error("SANDBOX_DEV_HOST_IP must be a single private IPv4 address");
  }
}
const DEV_UPSTREAM_CA = process.env.SANDBOX_UPSTREAM_CA;

const live = new Map<string, Sandbox>();
/** Long-running processes (the browser); the handle must stay referenced or the process is reaped. */
const processes = new Map<string, unknown>();

function shortId() {
  return randomBytes(4).toString("hex");
}

/** URL-safe placeholder: survives form encoding and JSON without escaping. */
export function placeholderFor(name: string): string {
  return `errand_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${randomBytes(6).toString("hex")}`;
}

function envName(name: string) {
  return `ERRAND_${name.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** SPKI pin of the Microsandbox interception CA, so Chromium accepts the runtime's TLS layer (which verifies upstream itself). */
function interceptionCaPin(): string | undefined {
  const crt = path.join(MSB_HOME, "tls", "ca.crt");
  if (!existsSync(crt)) return undefined;
  const pem = readFileSync(crt, "utf8");
  const der = new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64");
}

async function guestKernel(sb: Sandbox): Promise<string> {
  try {
    return (await sb.shell("uname -sr")).stdout().trim();
  } catch {
    return "unknown";
  }
}

export async function createBrowserSandbox(opts: {
  runId: string;
  label: string;
  secrets: SecretBinding[];
  cpus?: number;
  memoryMb?: number;
  maxDurationS?: number;
}): Promise<BrowserSandbox> {
  const name = `errand-${opts.runId.slice(-8)}-${opts.label}-${shortId()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const cpus = opts.cpus ?? 2;
  const memory = opts.memoryMb ?? 1536;
  const maxDuration = opts.maxDurationS ?? 1800;
  const port = await freePort();
  const placeholders: Record<string, string> = {};

  let builder = Sandbox.builder(name)
    .image(BROWSER_IMAGE)
    .cpus(cpus)
    .memory(memory)
    .replace()
    .interceptTls()
    .port(port, 9222);
  // Resource and lifetime caps are enforced by the runtime, not by the agent.
  builder = (builder as any).maxDuration ? (builder as any).maxDuration(maxDuration) : builder;

  builder = builder.network((n: any) => {
    let net = n;
    if (DEV_HOST_IP) {
      // Public egress plus exactly one private destination: HTTPS on the development machine.
      const base = NetworkPolicy.fromProfiles(["public"]);
      const storeRule = { direction: "egress", destination: Destination.cidr(`${DEV_HOST_IP}/32`), protocols: ["tcp"], ports: [{ start: 443, end: 443 }], action: "allow" } as const;
      net = net.policy({ ...base, rules: [storeRule, ...base.rules] });
    }
    if (DEV_UPSTREAM_CA) net = net.tls((t: any) => t.upstreamCaCert(path.resolve(DEV_UPSTREAM_CA)));
    for (const s of opts.secrets) {
      const ph = placeholderFor(s.name);
      placeholders[s.name] = ph;
      net = net.secret((b: any) => {
        let sb = b.env(envName(s.name)).value(s.value).placeholder(ph).substituteInBody(true);
        for (const h of s.allowHosts) sb = sb.allow(h);
        return sb;
      });
    }
    return net;
  });

  const sb = await builder.create();
  live.set(name, sb);

  // The first sandbox with TLS interception creates the CA; read the pin after create.
  const pin = interceptionCaPin();
  const flags = [
    "--disable-http2",
    "--user-data-dir=/tmp/profile",
    "--window-size=1280,860",
    "--lang=en-US",
    ...(pin ? [`--ignore-certificate-errors-spki-list=${pin}`] : []),
  ];
  processes.set(name, await sb.execStream("/headless-shell/run.sh", flags));

  return {
    id: name,
    name,
    cdp: { host: "127.0.0.1", port },
    placeholders,
    isolation: {
      backend: "microsandbox",
      kernel: await guestKernel(sb),
      network_policy: `public egress${DEV_HOST_IP ? ` + tcp/443 to ${DEV_HOST_IP} (local development)` : ""}; credentials bound to ${[...new Set(opts.secrets.flatMap((s) => s.allowHosts))].join(", ") || "none"}`,
      limits: { cpus, memory_mb: memory, timeout_s: maxDuration },
    },
  };
}

export async function createComputeSandbox(opts: { runId: string; memoryMb?: number; maxDurationS?: number }): Promise<ComputeSandbox> {
  const name = `errand-${opts.runId.slice(-8)}-compute-${shortId()}`.toLowerCase();
  const memory = opts.memoryMb ?? 512;
  const maxDuration = opts.maxDurationS ?? 600;
  let builder = Sandbox.builder(name).image(COMPUTE_IMAGE).cpus(1).memory(memory).replace().disableNetwork();
  builder = (builder as any).maxDuration ? (builder as any).maxDuration(maxDuration) : builder;
  const sb = await builder.create();
  live.set(name, sb);
  return {
    id: name,
    name,
    isolation: {
      backend: "microsandbox",
      kernel: await guestKernel(sb),
      network_policy: "no network",
      limits: { cpus: 1, memory_mb: memory, timeout_s: maxDuration },
    },
  };
}

function get(id: string): Sandbox {
  const sb = live.get(id);
  if (!sb) throw new Error(`unknown sandbox ${id}`);
  return sb;
}

export async function exec(id: string, cmd: string, args: string[], timeoutS: number): Promise<ExecResult> {
  const sb = get(id);
  const started = Date.now();
  try {
    const out = await sb.execWith(cmd, (b) => b.args(args).timeout(timeoutS * 1000));
    return { exit_code: out.code, stdout: out.stdout(), stderr: out.stderr(), duration_ms: Date.now() - started, timed_out: false };
  } catch (e) {
    const msg = String(e);
    const timedOut = /timed? ?out/i.test(msg);
    return { exit_code: -1, stdout: "", stderr: msg.slice(0, 2000), duration_ms: Date.now() - started, timed_out: timedOut };
  }
}

export async function writeFile(id: string, filePath: string, data: string | Uint8Array) {
  const fs = get(id).fs();
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  if (dir && !(await fs.exists(dir).catch(() => false))) await fs.mkdir(dir).catch(() => {});
  await fs.write(filePath, data);
}

export async function readFile(id: string, filePath: string): Promise<Buffer> {
  return Buffer.from(await get(id).fs().read(filePath));
}

export async function metrics(id: string) {
  return get(id).metrics();
}

/** Stop and delete the microVM. Always called when a task ends (lifecycle discipline). */
export async function destroy(id: string) {
  const sb = live.get(id);
  if (!sb) return;
  live.delete(id);
  const proc = processes.get(id) as { kill?: () => Promise<void> } | undefined;
  processes.delete(id);
  await proc?.kill?.().catch(() => {});
  await sb.kill().catch(() => {});
  await (sb as any).destroy?.().catch?.(() => {});
}

export async function destroyAll() {
  await Promise.all([...live.keys()].map(destroy));
}

export function liveCount() {
  return live.size;
}
