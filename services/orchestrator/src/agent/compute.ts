import type { Quote } from "@errand/shared";
import { config } from "../config.js";
import { chat } from "../inference/client.js";
import * as sandboxes from "../sandbox/microsandbox.js";
import type { Ledger } from "../runs/ledger.js";
import type { Requirements } from "./plan.js";

export interface Candidate {
  supplier: string;
  product: string;
  eligible: boolean;
  reasons: string[];
  unit_price_usd: number;
  subtotal_usd: number;
  shipping_usd: number;
  total_usd: number;
  lead_time_business_days: number;
}

export interface ComputeResult {
  candidates: Candidate[];
  winner: Candidate | null;
}

/** Reference computation in the control plane, used to check the sandboxed code's answer. */
export function referenceCompute(quotes: Quote[], req: Requirements): ComputeResult {
  const candidates = quotes.map((q): Candidate => {
    const tiers = [...(q.volume_tiers ?? [])].sort((a, b) => b.min_qty - a.min_qty);
    const tier = tiers.find((t) => req.quantity >= t.min_qty);
    const unit = Math.min(q.unit_price_usd, tier?.unit_price_usd ?? Infinity);
    const subtotal = round2(unit * req.quantity);
    const free = q.free_shipping_threshold_usd > 0 && subtotal >= q.free_shipping_threshold_usd;
    const shipping = free ? 0 : round2((q.shipping_per_order_usd || 0) + (q.shipping_per_unit_usd || 0) * req.quantity);
    const total = round2(subtotal + shipping);
    const reasons: string[] = [];
    if (q.quantity_available < req.quantity) reasons.push(`only ${q.quantity_available} in stock`);
    if (q.lead_time_business_days > req.deadline_business_days) reasons.push(`lead time ${q.lead_time_business_days} > ${req.deadline_business_days} business days`);
    if ((q.power_delivery_w ?? 0) < req.min_power_delivery_w) reasons.push(`power delivery ${q.power_delivery_w ?? "?"} W < ${req.min_power_delivery_w} W`);
    if ((q.external_4k_displays ?? 0) < req.min_external_4k_displays) reasons.push(`drives ${q.external_4k_displays ?? "?"} external 4K displays, needs ${req.min_external_4k_displays}`);
    if (total > req.budget_usd) reasons.push(`total $${total} over budget $${req.budget_usd}`);
    return {
      supplier: q.supplier,
      product: q.product,
      eligible: reasons.length === 0,
      reasons,
      unit_price_usd: unit,
      subtotal_usd: subtotal,
      shipping_usd: shipping,
      total_usd: total,
      lead_time_business_days: q.lead_time_business_days,
    };
  });
  const winner = candidates.filter((c) => c.eligible).sort((a, b) => a.total_usd - b.total_usd)[0] ?? null;
  return { candidates, winner };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const CODER_SYSTEM = `You write one self-contained Python 3 script (standard library only, no network) for a purchasing team.
It reads /work/quotes.json (a list of supplier offers) and /work/requirements.json, and writes /work/result.json:
{"candidates":[{"supplier","product","eligible","reasons":[...],"unit_price_usd","subtotal_usd","shipping_usd","total_usd","lead_time_business_days"}],"winner":<candidate or null>}
Rules: the unit price for the requested quantity is the lowest of unit_price_usd and any volume tier whose min_qty <= quantity; subtotal = unit price * quantity;
shipping = 0 if free_shipping_threshold_usd > 0 and subtotal >= free_shipping_threshold_usd, else shipping_per_order_usd + shipping_per_unit_usd * quantity; total = subtotal + shipping; round money to cents.
A candidate is eligible only if stock >= quantity, lead time <= deadline_business_days, power_delivery_w >= min_power_delivery_w, external_4k_displays >= min_external_4k_displays and total <= budget_usd; list every failed rule in reasons.
The winner is the eligible candidate with the lowest total. Print a short human-readable comparison table to stdout. Reply with the script only, in one python code block.`;

function extractCode(text: string): string {
  const m = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  return (m?.[1] ?? text).trim();
}

/**
 * Pattern A: the model writes the comparison code, the code runs in a microVM with no network,
 * errors are fed back, and the control plane re-checks the answer before anything is ordered.
 */
export async function computeLandedCost(params: { runId: string; quotes: Quote[]; requirements: Requirements; ledger: Ledger }) {
  const { ledger } = params;
  const reference = referenceCompute(params.quotes, params.requirements);
  const box = await sandboxes.createComputeSandbox({ runId: params.runId, memoryMb: config.limits.computeMemoryMb });
  ledger.append("sandbox", "Compute microVM started (no network)", { sandbox: box.id, isolation: box.isolation });
  try {
    await sandboxes.writeFile(box.id, "/work/quotes.json", JSON.stringify(params.quotes, null, 2));
    await sandboxes.writeFile(box.id, "/work/requirements.json", JSON.stringify(params.requirements, null, 2));

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: CODER_SYSTEM },
      { role: "user", content: `requirements.json:\n${JSON.stringify(params.requirements)}\nquotes.json (first 2):\n${JSON.stringify(params.quotes.slice(0, 2))}` },
    ];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await chat({ model: config.inference.models.coder, messages, temperature: 0, max_tokens: 4000, reasoning_effort: "low" });
      const reply = typeof res.message.content === "string" ? res.message.content : "";
      const code = extractCode(reply);
      await sandboxes.writeFile(box.id, "/work/landed_cost.py", code);
      const out = await sandboxes.exec(box.id, "python3", ["/work/landed_cost.py"], 30);
      ledger.append("compute", `Attempt ${attempt}: script exited ${out.exit_code}`, {
        model: res.model,
        code,
        stdout: out.stdout.slice(0, 4000),
        stderr: out.stderr.slice(0, 2000),
        duration_ms: out.duration_ms,
      });
      if (out.exit_code === 0) {
        let result: ComputeResult | undefined;
        try {
          result = JSON.parse((await sandboxes.readFile(box.id, "/work/result.json")).toString("utf8"));
        } catch (e) {
          messages.push({ role: "assistant", content: reply }, { role: "user", content: `The script ran but /work/result.json was missing or invalid: ${String(e).slice(0, 300)}. Fix it.` });
          continue;
        }
        const agrees =
          (result?.winner?.supplier ?? null) === (reference.winner?.supplier ?? null) &&
          (result?.winner?.product ?? null) === (reference.winner?.product ?? null) &&
          Math.abs((result?.winner?.total_usd ?? 0) - (reference.winner?.total_usd ?? 0)) < 0.01;
        ledger.append("compute", agrees ? "Sandboxed result matches the control-plane check" : "Sandboxed result DISAGREES with the control-plane check", {
          sandbox_winner: result?.winner ?? null,
          reference_winner: reference.winner,
        });
        if (agrees) return { result: result!, reference, stdout: out.stdout, code, attempts: attempt, agrees };
        messages.push(
          { role: "assistant", content: reply },
          { role: "user", content: `Your result picked ${JSON.stringify(result?.winner)} but applying the rules exactly gives a different answer. Re-read the rules and fix the script.` },
        );
        continue;
      }
      messages.push({ role: "assistant", content: reply }, { role: "user", content: `The script failed (exit ${out.exit_code}).\nstderr:\n${out.stderr.slice(0, 1500)}\nFix it.` });
    }
    // The order never proceeds on an unchecked number: fall back to the control-plane answer, and say so.
    ledger.append("compute", "Using the control-plane computation after 3 sandbox attempts", { reference_winner: reference.winner });
    return { result: reference, reference, stdout: "", code: "", attempts: 3, agrees: false };
  } finally {
    await sandboxes.destroy(box.id);
    ledger.append("sandbox", "Compute microVM destroyed", { sandbox: box.id });
  }
}
