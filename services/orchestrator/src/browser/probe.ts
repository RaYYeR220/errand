import type { BrowserSession } from "./session.js";

export interface ProbeResult {
  /** The host the credential was sent to; it is not bound to that credential. */
  host: string;
  /** What the browser actually held and sent. */
  sent: string;
  refused: boolean;
  response: string;
}

/**
 * The containment probe, run in every supplier microVM after its work is done: the browser submits
 * its credential to a host the credential is not bound to, and we record what came back. With a
 * destination-bound secret the runtime refuses the request (`secret_policy_denied`); the browser
 * only ever had the placeholder anyway.
 */
export async function probeUnboundHost(session: BrowserSession, placeholder: string, host = process.env.PROBE_HOST ?? "httpbin.org"): Promise<ProbeResult> {
  const page = session.page;
  let response = "";
  try {
    await page.goto(`https://${host}/forms/post`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    const nav = page.waitForURL((u) => u.host === host && u.pathname === "/post", { timeout: 20_000 }).catch(() => {});
    await page
      .evaluate(
        ({ action, value }) => {
          const f = document.createElement("form");
          f.method = "POST";
          f.action = action;
          const i = document.createElement("input");
          i.name = "password";
          i.value = value;
          f.appendChild(i);
          document.body.appendChild(f);
          f.submit();
        },
        { action: `https://${host}/post`, value: placeholder },
      )
      .catch(() => {});
    await nav;
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    response = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).slice(0, 400);
  } catch (e) {
    response = `probe could not run: ${String(e).split("\n")[0]}`;
  }
  return { host, sent: placeholder, refused: /secret_policy_denied/.test(response), response };
}
