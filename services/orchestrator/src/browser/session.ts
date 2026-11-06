import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * A browser running inside a sandbox, driven over CDP from the control plane.
 * The browser itself only ever holds placeholders; this class never sees real secrets either.
 */
export class BrowserSession {
  private constructor(
    private readonly browser: Browser,
    readonly context: BrowserContext,
    public page: Page,
  ) {}

  static async connect(cdp: { host: string; port: number }): Promise<BrowserSession> {
    const base = `http://${cdp.host}:${cdp.port}`;
    // Fetch the websocket URL ourselves: the browser reports its in-sandbox address,
    // which is not reachable from here, so swap in the published host and port.
    let wsUrl: string | undefined;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      try {
        const info = (await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(2000) })).json()) as { webSocketDebuggerUrl?: string };
        if (info.webSocketDebuggerUrl) {
          const u = new URL(info.webSocketDebuggerUrl);
          u.hostname = cdp.host;
          u.port = String(cdp.port);
          wsUrl = u.toString();
        }
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!wsUrl) throw new Error(`browser in sandbox did not expose CDP at ${base}`);
    const browser = await chromium.connectOverCDP(wsUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1280, height: 860 });
    const session = new BrowserSession(browser, context, page);
    context.on("page", (p) => {
      // Follow pop-ups and target=_blank so the agent always acts on the newest tab.
      session.page = p;
    });
    return session;
  }

  async snapshot(maxChars = 14_000): Promise<{ url: string; title: string; tree: string; truncated: boolean }> {
    const page = this.page;
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    const tree = await page.ariaSnapshot({ mode: "ai", timeout: 15_000 }).catch((e) => `(snapshot unavailable: ${String(e).slice(0, 200)})`);
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      tree: tree.length > maxChars ? tree.slice(0, maxChars) : tree,
      truncated: tree.length > maxChars,
    };
  }

  async screenshot(opts: { quality?: number; fullPage?: boolean } = {}): Promise<Buffer> {
    return this.page.screenshot({ type: "jpeg", quality: opts.quality ?? 70, fullPage: opts.fullPage ?? false, timeout: 20_000 });
  }

  async visibleText(maxChars = 12_000): Promise<string> {
    const text = await this.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return text.slice(0, maxChars);
  }

  private ref(ref: string) {
    return this.page.locator(`aria-ref=${ref}`);
  }

  async navigate(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  async click(ref: string) {
    await this.ref(ref).click({ timeout: 10_000 });
    await this.settle();
  }

  async fill(ref: string, text: string) {
    await this.ref(ref).fill(text, { timeout: 10_000 });
  }

  async select(ref: string, value: string) {
    await this.ref(ref).selectOption({ label: value }, { timeout: 10_000 }).catch(() => this.ref(ref).selectOption(value, { timeout: 10_000 }));
  }

  async press(key: string) {
    await this.page.keyboard.press(key);
    await this.settle();
  }

  async scroll(direction: "up" | "down") {
    await this.page.mouse.wheel(0, direction === "down" ? 700 : -700);
  }

  /** Wait briefly for navigation/network to calm down; never throws. */
  async settle(ms = 8_000) {
    await this.page.waitForLoadState("domcontentloaded", { timeout: ms }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: Math.min(ms, 3_000) }).catch(() => {});
  }

  async close() {
    await this.browser.close().catch(() => {});
  }
}
