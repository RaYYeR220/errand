"use client";

import { useEffect, useRef, useState } from "react";

type Step = { label: string; short: string; detail: string; hash: string; prev_hash?: string; held?: boolean };
type Showcase = { run_id: string; head: string; intact: boolean; entries: number; steps: Step[] };

/** Shown only until the first real errand completes; labelled as an example in the UI. */
const EXAMPLE: Step[] = [
  ["Request received", "Request", "12 docks · dual 4K · ≥ 90 W · ≤ 3 days · ≤ $2,400"],
  ["microVM up · northwind", "microVM · northwind", "own kernel · CPU, memory and time capped"],
  ["Offers read · Northwind", "Offers · northwind", "signed in with a placeholder"],
  ["microVM up · acme", "microVM · acme", "own kernel · CPU, memory and time capped"],
  ["Offers read · Acme", "Offers · acme", "signed in with a placeholder"],
  ["Landed cost computed", "Landed cost", "code ran in a microVM with no network"],
  ["Order microVM up", "Order microVM", "a fresh microVM signs in again"],
  ["Place order held", "Order held", "the request stopped before it left the browser"],
  ["Order checked", "Checked", "item · quantity · ship-to · PO · budget"],
  ["Released by the reviewer", "Approved", "a person released the held request"],
  ["Order placed", "Placed", "12 × Dell WD19S 130W"],
  ["microVMs destroyed", "VMs destroyed", "browsers and sessions gone"],
  ["Receipt sealed", "Sealed", "final hash of the chain"],
].map(([label, short, detail], i) => ({ label, short, detail, hash: "", held: i === 7 }));

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function ChainHero({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<{ steps: Step[]; real: boolean; meta?: Showcase }>({ steps: EXAMPLE, real: false });

  useEffect(() => {
    let off = false;
    fetch("/api/showcase")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Showcase | null) => {
        if (!off && s?.steps?.length) setData({ steps: s.steps, real: true, meta: s });
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const tip = tipRef.current!;
    const hero = heroRef.current!;
    const STEPS = data.steps;
    const N = STEPS.length;
    const HELD = Math.max(0, STEPS.findIndex((s) => s.held));
    const C = { ink: "#edebe6", ink2: "#a3a19c", ink3: "#62615d", acc: "#ff6a3d", bg: "#0a0a0b" };
    const SANS = getComputedStyle(document.body).getPropertyValue("--font-sans") || "system-ui, sans-serif";
    const MONO = getComputedStyle(document.body).getPropertyValue("--font-mono") || "ui-monospace, monospace";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0,
      H = 0,
      vertical = false,
      raf = 0;
    let P: { x: number; y: number; nx: number; ny: number; tier: number }[] = [];
    const hashes: string[] = STEPS.map((s) => s.hash);

    // The example chain has no ledger behind it: hash its text so the motion still shows real SHA-256.
    if (!data.real) {
      (async () => {
        let prev = "0".repeat(64);
        for (let i = 0; i < N; i++) {
          prev = await sha256hex(`${prev}|${STEPS[i]!.label}|${STEPS[i]!.detail}`);
          hashes[i] = prev;
        }
      })().catch(() => {});
    }

    function layout() {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vertical = innerWidth <= 860;
      P = STEPS.map((_, i) => {
        if (vertical) return { x: 26, y: 24 + i * ((H - 84) / Math.max(1, N - 1)), nx: 0, ny: 1, tier: 0 };
        const u = i / Math.max(1, N - 1);
        const x = W * (0.07 + 0.86 * u);
        const hw = W * 0.43;
        const k = (x - W / 2) / hw;
        const yb = H * 0.86,
          ye = H * 0.69;
        const y = yb - (yb - ye) * k * k;
        const dy = (-2 * (yb - ye) * k) / hw;
        const n = Math.hypot(1, dy);
        return { x, y, nx: dy / n, ny: 1 / n, tier: [26, -26, 60, -60][i % 4]! };
      });
    }
    const landT = (i: number) => (i <= HELD ? 0.5 + i * 0.6 : 0.5 + HELD * 0.6 + 2.8 + (i - HELD - 1) * 0.6);
    const SEAL = landT(N - 1) + 0.6;
    const LOOP = SEAL + 5.2;
    const ease = (k: number) => {
      k = Math.max(0, Math.min(1, k));
      return 1 - Math.pow(1 - k, 3);
    };
    const HEX = "0123456789abcdef";
    let t0 = performance.now();

    function frame(now: number) {
      let t = (now - t0) / 1000;
      if (t > LOOP) {
        t0 = now;
        t = 0;
      }
      const fade = t > LOOP - 0.9 ? Math.max(0, (LOOP - t) / 0.9) : 1;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(237,235,230,.06)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = fade;
      for (let i = 1; i < N; i++) {
        const k = ease((t - (landT(i) - 0.35)) / 0.35);
        if (k <= 0) continue;
        const a = P[i - 1]!,
          b = P[i]!;
        ctx.strokeStyle = C.ink2;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        ctx.stroke();
      }
      const heldOn = t > landT(HELD) && t < landT(HELD + 1) - 0.35;
      if (heldOn && P[HELD + 1]) {
        const a = P[HELD]!,
          b = P[HELD + 1]!;
        ctx.strokeStyle = C.acc;
        ctx.setLineDash([3, 4]);
        ctx.lineDashOffset = -t * 12;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const vk = (t - SEAL - 0.2) / 1.8;
      P.forEach((p, i) => {
        const lt = landT(i);
        if (t < lt) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, 7);
          ctx.fillStyle = "rgba(237,235,230,.14)";
          ctx.fill();
          return;
        }
        const age = t - lt,
          isHeld = i === HELD,
          last = i === N - 1;
        const verified = vk > i / (N - 1) && vk < 1.6;
        if (age < 0.7) {
          ctx.strokeStyle = `rgba(237,235,230,${0.5 * (1 - age / 0.7)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5 + 12 * ease(age / 0.7), 0, 7);
          ctx.stroke();
        }
        if (isHeld && heldOn) {
          const ph = (t * 1.2) % 1;
          ctx.strokeStyle = `rgba(255,106,61,${0.6 * (1 - ph)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6 + 12 * ph, 0, 7);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, last ? 5.5 : 4, 0, 7);
        ctx.fillStyle = (isHeld && heldOn) || (last && t > SEAL) ? C.acc : verified ? C.ink : C.bg;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = (isHeld && heldOn) || last ? C.acc : C.ink;
        ctx.stroke();
        let hs = (hashes[i] || "").slice(0, 8);
        if (age < 0.35) hs = [...Array(8)].map((_, j) => HEX[(Math.floor(t * 40) + j * 7 + i) % 16]).join("");
        ctx.globalAlpha = fade * Math.min(1, age / 0.3);
        ctx.textAlign = vertical ? "left" : "center";
        const up = !vertical && p.tier < 0;
        const ax = p.x + p.nx * p.tier,
          ay = p.y + p.ny * p.tier;
        const lx = vertical ? p.x + 18 : ax,
          ly = vertical ? p.y - 3 : up ? ay - 12 : ay + 4;
        if (!vertical) {
          const sg = Math.sign(p.tier),
            e = Math.abs(p.tier) - 12;
          ctx.strokeStyle = "rgba(237,235,230,.13)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x + p.nx * 8 * sg, p.y + p.ny * 8 * sg);
          ctx.lineTo(p.x + p.nx * e * sg, p.y + p.ny * e * sg);
          ctx.stroke();
        }
        ctx.font = `500 ${vertical ? 13 : 12.5}px ${SANS}`;
        ctx.fillStyle = isHeld && heldOn ? C.acc : C.ink;
        ctx.fillText(vertical ? (isHeld && heldOn ? "Place order held · waiting for approval" : STEPS[i]!.label) : isHeld && heldOn ? "Held · waiting for you" : STEPS[i]!.short, lx, ly);
        ctx.font = `10.5px ${MONO}`;
        ctx.fillStyle = verified ? C.ink2 : C.ink3;
        ctx.fillText((verified ? "✓ " : "") + hs, lx, ly + 15);
        ctx.globalAlpha = fade;
      });
      if (vk > 0 && vk < 1) {
        const f = vk * (N - 1),
          i = Math.floor(f),
          k = f - i,
          a = P[i]!,
          b = P[Math.min(N - 1, i + 1)]!;
        const x = a.x + (b.x - a.x) * k,
          y = a.y + (b.y - a.y) * k;
        ctx.fillStyle = C.acc;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 7);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,106,61,.35)";
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 7);
        ctx.stroke();
      }
      const head = hashes[N - 1];
      if (t > SEAL + 2.0 && head) {
        const k = ease((t - SEAL - 2.0) / 0.5),
          p = P[N - 1]!;
        const txt = `sealed · sha256 ${head.slice(0, 16)}…${head.slice(-6)}`;
        ctx.font = `11px ${MONO}`;
        const tw = ctx.measureText(txt).width + 22;
        const bx = vertical ? p.x + 14 : p.x - tw - 16,
          by = vertical ? p.y + 20 : p.y - 46;
        ctx.globalAlpha = fade * k;
        ctx.fillStyle = "rgba(255,106,61,.1)";
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, 24, 12);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,106,61,.5)";
        ctx.beginPath();
        ctx.roundRect(bx + 0.5, by + 0.5, tw - 1, 23, 11.5);
        ctx.stroke();
        ctx.fillStyle = C.acc;
        ctx.textAlign = "left";
        ctx.fillText(txt, bx + 11, by + 16);
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      let best = -1,
        bd = 22;
      P.forEach((p, i) => {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best < 0) {
        tip.style.opacity = "0";
        return;
      }
      const hr = hero.getBoundingClientRect();
      const s = STEPS[best]!;
      tip.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = s.label;
      const d = document.createElement("div");
      d.textContent = s.detail;
      const h1 = document.createElement("div");
      h1.textContent = `sha256 ${(hashes[best] || "").slice(0, 32)}…`;
      const h2 = document.createElement("div");
      h2.textContent = `prev ${best ? (hashes[best - 1] || "").slice(0, 16) + "…" : "genesis"}`;
      tip.append(b, d, h1, h2);
      tip.style.left = Math.min(r.left - hr.left + P[best]!.x + 14, hr.width - 330) + "px";
      tip.style.top = r.top - hr.top + P[best]!.y - 80 + "px";
      tip.style.opacity = "1";
    };
    const onLeave = () => (tip.style.opacity = "0");
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("a,button")) t0 = performance.now();
    };
    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("mouseleave", onLeave);
    hero.addEventListener("click", onClick);
    // Without motion, the chain is drawn once in its sealed state, and again whenever the layout changes.
    const relayout = () => {
      layout();
      if (reduce) frame(performance.now());
    };
    addEventListener("resize", relayout);
    if (reduce) t0 -= (SEAL + 3) * 1000;
    relayout();
    document.fonts?.ready.then(relayout);
    if (!reduce) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("mouseleave", onLeave);
      hero.removeEventListener("click", onClick);
      removeEventListener("resize", relayout);
    };
  }, [data]);

  return (
    <section className="hero" ref={heroRef}>
      <canvas
        ref={canvasRef}
        className="hero-canvas"
        aria-label="A real errand's hash-chained ledger: each step links to the one before it, the order is held for approval, and the chain ends in a sealed receipt"
      />
      <div className="hero-wrap">{children}</div>
      <div className="hero-tip" ref={tipRef} />
      <p className="hero-source">
        {data.real && data.meta ? (
          <>
            Drawn from errand <a href={`/errands/${data.meta.run_id}`}>{data.meta.run_id}</a> · {data.meta.entries} ledger entries · chain {data.meta.intact ? "intact" : "broken"}
          </>
        ) : (
          <>Example chain · run an errand to see a real one</>
        )}
      </p>
    </section>
  );
}
