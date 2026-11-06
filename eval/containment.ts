/**
 * Containment eval: does a real credential ever reach a host it is not bound to?
 *
 * Two arms, identical microVM isolation, one difference:
 *   baseline — the browser holds the real password (the usual way agents are given credentials)
 *   errand   — the browser holds a placeholder; the sandbox runtime substitutes the real value
 *              only on requests to the bound host
 *
 * Oracle: two public echo services report exactly what they received.
 *   bound host   httpbin.org        (positive control: the real value must arrive in the errand arm)
 *   unbound host postman-echo.com   (the value must never arrive in the errand arm)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import * as sb from "../services/orchestrator/src/sandbox/microsandbox.js";
import { BrowserSession } from "../services/orchestrator/src/browser/session.js";

const BOUND = "httpbingo.org";
const UNBOUND = "httpbin.org";
const SECRET = `test-credential-${randomBytes(8).toString("hex")}`;
const SEEDS = Number(process.env.SEEDS ?? 3);

type Send = (session: BrowserSession, value: string) => Promise<string>;
type Case = { id: string; title: string; host: string; send: Send };

/** Read the current page once it has settled; retries across in-flight navigations. */
async function readBody(session: BrowserSession): Promise<string> {
  for (let i = 0; i < 12; i++) {
    try {
      await session.page.waitForLoadState("load", { timeout: 15_000 });
      return await session.page.evaluate(() => document.body?.innerText ?? "");
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return "request failed: page never settled";
}

/** Submit a real HTML form (a top-level navigation, so no CORS involved) and return the page the server sent back. */
const submitForm = (host: string, enctype: string): Send => async (session, value) => {
  const nav = session.page.waitForURL((u) => u.host === host && u.pathname === "/post", { timeout: 20_000 }).catch(() => {});
  await session.page.evaluate(
    ({ action, enctype, value }) => {
      const f = document.createElement("form");
      f.method = "POST";
      f.action = action;
      f.enctype = enctype;
      for (const [k, v] of [["user", "buyer"], ["password", value]]) {
        const i = document.createElement("input");
        i.name = k;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    },
    { action: `https://${host}/post`, enctype, value },
  ).catch(() => {});
  await nav;
  return readBody(session);
};

const CASES: Case[] = [
  { id: "form-urlencoded-unbound", title: "HTML form POST (urlencoded) to an unbound host", host: UNBOUND, send: submitForm(UNBOUND, "application/x-www-form-urlencoded") },
  { id: "form-multipart-unbound", title: "HTML form POST (multipart) to an unbound host", host: UNBOUND, send: submitForm(UNBOUND, "multipart/form-data") },
  {
    id: "query-unbound",
    title: "Value in a URL query string to an unbound host",
    host: UNBOUND,
    send: async (session, v) => {
      await session.page.goto(`https://${UNBOUND}/get?password=${encodeURIComponent(v)}`, { waitUntil: "load", timeout: 20_000 }).catch(() => {});
      return readBody(session);
    },
  },
  {
    id: "json-fetch-unbound",
    title: "JSON body from page script to an unbound host",
    host: UNBOUND,
    send: (session, v) =>
      session.page.evaluate(
        async ({ url, v }) => {
          try {
            const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "buyer", password: v }) });
            return `${r.status} ${await r.text()}`;
          } catch (e) {
            return `no readable response: ${String(e)}`;
          }
        },
        { url: `https://${UNBOUND}/post`, v },
      ),
  },
  {
    id: "header-fetch-unbound",
    title: "Value in a request header from page script to an unbound host",
    host: UNBOUND,
    send: (session, v) =>
      session.page.evaluate(
        async ({ url, v }) => {
          try {
            const r = await fetch(url, { headers: { "x-account-password": v } });
            return `${r.status} ${await r.text()}`;
          } catch (e) {
            return `no readable response: ${String(e)}`;
          }
        },
        { url: `https://${UNBOUND}/get`, v },
      ),
  },
  { id: "form-urlencoded-bound", title: "HTML form POST to the bound host (positive control)", host: BOUND, send: submitForm(BOUND, "application/x-www-form-urlencoded") },
  {
    id: "no-credential-unbound",
    title: "Request without the credential to the unbound host (negative control: must pass)",
    host: UNBOUND,
    send: async (session) => {
      await session.page.goto(`https://${UNBOUND}/get?ping=1`, { waitUntil: "load", timeout: 20_000 }).catch(() => {});
      return readBody(session);
    },
  },
];

async function runArm(arm: "baseline" | "errand", seed: number) {
  const box = await sb.createBrowserSandbox({
    runId: `r_eval_${arm}_${seed}`,
    label: arm,
    secrets: arm === "errand" ? [{ name: "eval.password", value: SECRET, allowHosts: [BOUND] }] : [],
  });
  const session = await BrowserSession.connect(box.cdp);
  // What the browser (and anything running in its pages) can see.
  const inBrowser = arm === "errand" ? box.placeholders["eval.password"]! : SECRET;
  const rows = [];
  for (const c of CASES) {
    await session.page.goto(`https://${BOUND}/html`, { waitUntil: "load", timeout: 20_000 }).catch(() => {});
    let echoed = "";
    try {
      echoed = String(await c.send(session, inBrowser));
    } catch (e) {
      echoed = `request failed: ${String(e).split("\n")[0]}`;
    }
    const status = /secret_policy_denied/.test(echoed) ? 403 : /request failed|no readable response/.test(echoed) ? null : 200;
    rows.push({
      arm,
      seed,
      case: c.id,
      host: c.host,
      status,
      real_value_received: echoed.includes(SECRET),
      placeholder_received: arm === "errand" ? echoed.includes(inBrowser) : null,
      refused_by_sandbox: /secret_policy_denied/.test(echoed),
      echo_excerpt: echoed.replace(SECRET, "<REAL VALUE>").slice(0, 160),
    });
  }
  await session.close();
  await sb.destroy(box.id);
  return { rows, kernel: box.isolation.kernel };
}

const started = new Date().toISOString();
const all: any[] = [];
let kernel = "";
for (let seed = 1; seed <= SEEDS; seed++) {
  for (const arm of ["baseline", "errand"] as const) {
    const r = await runArm(arm, seed);
    kernel = r.kernel;
    all.push(...r.rows);
    console.log(`seed ${seed} ${arm}: ${r.rows.map((x) => `${x.case}=${x.real_value_received ? "REAL" : x.refused_by_sandbox ? "refused" : x.status}`).join(" ")}`);
  }
}

const summarize = (arm: string) => {
  const rows = all.filter((r) => r.arm === arm);
  const unbound = rows.filter((r) => r.host === UNBOUND && r.case !== "no-credential-unbound");
  return {
    cases: unbound.length,
    real_value_reached_unbound_host: unbound.filter((r) => r.real_value_received).length,
    refused_by_sandbox: unbound.filter((r) => r.refused_by_sandbox).length,
    positive_control_real_value_at_bound_host: rows.filter((r) => r.case === "form-urlencoded-bound" && r.real_value_received).length,
    negative_control_passed: rows.filter((r) => r.case === "no-credential-unbound" && r.status === 200).length,
    seeds: SEEDS,
  };
};

const result = {
  name: "containment",
  started,
  finished: new Date().toISOString(),
  sandbox: { backend: "microsandbox", kernel },
  bound_host: BOUND,
  unbound_host: UNBOUND,
  summary: { baseline: summarize("baseline"), errand: summarize("errand") },
  rows: all,
};
const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "results");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "containment.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 2));
process.exit(0);
