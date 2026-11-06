"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChainHero } from "@/components/landing/ChainHero";
import { rememberReviewToken, startErrand } from "@/lib/api";

type Containment = {
  summary: {
    baseline: { cases: number; real_value_reached_unbound_host: number };
    errand: { cases: number; real_value_reached_unbound_host: number; refused_by_sandbox: number; positive_control_real_value_at_bound_host: number; seeds: number };
  };
  sandbox: { kernel: string };
  finished: string;
};

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <rect x=".5" y=".5" width="21" height="21" rx="6" stroke="#edebe6" />
      <rect x="6" y="6" width="10" height="10" rx="2.5" fill="#edebe6" />
      <path d="M16 11h6" stroke="#ff6a3d" strokeWidth="1.6" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [containment, setContainment] = useState<Containment | null>(null);

  useEffect(() => {
    fetch("/api/eval/containment")
      .then((r) => (r.ok ? r.json() : null))
      .then(setContainment)
      .catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startErrand({});
      rememberReviewToken(r.id, r.review_token);
      router.push(`/errands/${r.id}#review=${r.review_token}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };

  const b = containment?.summary.baseline;
  const e = containment?.summary.errand;

  return (
    <main>
      <div className="grain" />
      <ChainHero>
        <nav className="nav">
          <a className="brand" href="/">
            <Mark />
            Errand
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#containment">Containment</a>
            <a href="#vultr">On Vultr</a>
            <a href="https://github.com/RaYYeR220/errand">GitHub</a>
          </div>
          <button className="nav-cta pill" style={{ height: 34 }} onClick={run} disabled={busy}>
            Run an errand
          </button>
        </nav>
        <div className="hero-copy">
          <h1>
            <span>Your agent works signed in.</span> <span>It never sees the password.</span>
          </h1>
          <p className="hero-sub">
            Errand buys from your suppliers the way your buyers do: signs in, compares contract prices, fills the purchase order, and waits for your approval. Every browser runs in its own microVM,
            every step lands in a hash-chained ledger.
          </p>
          <div className="hero-ctas">
            <button className="pill primary" onClick={run} disabled={busy}>
              {busy ? "Starting a microVM…" : "Run an errand →"}
            </button>
            <a className="pill" href="#how">
              How it works
            </a>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="hero-proof">
            <b />
            Live on Vultr · microVMs on VX1 · models on Vultr Serverless Inference
          </div>
        </div>
      </ChainHero>

      <section className="band" id="how">
        <h2>Three things happen outside the agent’s reach.</h2>
        <p className="lede">
          The model plans, reads pages, clicks and writes code. It never holds a credential, never decides on its own that an order goes out, and never keeps a machine it used.
        </p>
        <div className="steps3">
          <div>
            <span className="n">01 · sign in</span>
            <h3>The browser types a placeholder</h3>
            <p>
              Inside the microVM the password is a token like <code>errand_northwind_password_…</code>. The sandbox runtime swaps in the real value outside the VM, only on requests to that supplier.
              Sent anywhere else, the request is refused.
            </p>
          </div>
          <div>
            <span className="n">02 · compare</span>
            <h3>The math runs in a sealed room</h3>
            <p>The model writes the landed-cost code; it runs in a second microVM with no network at all, and the control plane re-checks the answer before anything is ordered.</p>
          </div>
          <div>
            <span className="n">03 · order</span>
            <h3>Place order waits at the edge</h3>
            <p>
              The order request is held before it leaves the browser. A decisions model reads the checkout against your request, the budget is checked in code, and a person releases it — or
              rejects it.
            </p>
          </div>
        </div>
      </section>

      <section className="band" id="containment">
        <h2>What the sandbox absorbed.</h2>
        <p className="lede">
          Same browser, same microVM, one difference: whether the real password is in the browser. Each case sends the credential toward a host it is not bound to; public echo services report what
          actually arrived.
        </p>
        <div className="figures">
          <div className="figure">
            <div className="big">
              <em>{e ? `${e.real_value_reached_unbound_host} / ${e.cases}` : "—"}</em>
            </div>
            <p>times the real password reached an unbound host with Errand{e ? ` (${e.refused_by_sandbox} refused outright by the sandbox runtime)` : ""}.</p>
          </div>
          <div className="figure">
            <div className="big">{b ? `${b.real_value_reached_unbound_host} / ${b.cases}` : "—"}</div>
            <p>times it did when the browser held the real password, the usual way agents are given credentials.</p>
          </div>
          <div className="figure">
            <div className="big">{e ? `${e.positive_control_real_value_at_bound_host} / ${e.seeds}` : "—"}</div>
            <p>positive controls: the real value still arrives at the bound host, so the sign-in works.</p>
          </div>
        </div>
        {containment && (
          <p className="figure src">
            eval/results/containment.json · {containment.sandbox.kernel} microVMs · {new Date(containment.finished).toUTCString()}
          </p>
        )}
      </section>

      <section className="band" id="vultr">
        <h2>Everything runs on Vultr.</h2>
        <p className="lede">One VX1 instance hosts the web app, the orchestrator and the microVMs (VX1 exposes nested virtualization). The models are called on Vultr Serverless Inference.</p>
        <div className="stack">
          <div>
            <b>VX1 Cloud Compute</b>
            <span>Microsandbox microVMs with their own kernel, CPU, memory and lifetime caps; destroyed when each task ends.</span>
          </div>
          <div>
            <b>glm-5.3</b>
            <span>Plans the errand and writes the landed-cost code.</span>
          </div>
          <div>
            <b>glm-5.3-flash</b>
            <span>Operates the browser from the page’s accessibility tree and a screenshot.</span>
          </div>
          <div>
            <b>clef (decisions)</b>
            <span>Calibrated yes/no checks of every offer and of the held order against its screenshot.</span>
          </div>
          <div>
            <b>nemotron-3.5-content-safety</b>
            <span>Flags page text aimed at the agent; a signal in the ledger, never the guarantee.</span>
          </div>
          <div>
            <b>Supplier network</b>
            <span>Two suppliers on real open-source commerce stacks (Medusa B2B, WooCommerce) on a second Vultr instance.</span>
          </div>
        </div>
      </section>

      <footer className="foot">
        <span>Errand · MIT licensed</span>
        <span>
          <a href="https://github.com/RaYYeR220/errand">Source</a> · MCP endpoint <code>/mcp</code> · <a href="/api/health">Health</a>
        </span>
      </footer>
    </main>
  );
}
