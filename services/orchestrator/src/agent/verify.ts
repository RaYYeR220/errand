import { randomUUID } from "node:crypto";
import type { Quote, VerifyResult, Decision } from "@errand/shared";
import { decide, type DecisionQuestion } from "../inference/client.js";
import type { HeldRequest } from "../browser/hold.js";

/** Thresholds for the decisions model's calibrated P(yes). */
export const PASS_AT = 0.85;
export const VETO_BELOW = 0.5;

function verdictFrom(checks: Record<string, Decision>): VerifyResult["verdict"] {
  const ps = Object.values(checks).map((c) => c.p);
  if (ps.some((p) => p === null)) return "unverified";
  if (ps.some((p) => (p as number) < VETO_BELOW)) return "fail";
  if (ps.every((p) => (p as number) >= PASS_AT)) return "pass";
  return "unverified";
}

async function run(state: Record<string, unknown>, questions: Record<string, DecisionQuestion>, image?: Buffer): Promise<VerifyResult> {
  const checks: Record<string, Decision> = {};
  for (const [id, q] of Object.entries(questions)) checks[id] = { p: null, question: q.instructions };
  try {
    const key = image ? `screenshot-${randomUUID()}` : undefined;
    const res = await decide({
      state: key ? { ...state, screenshot: key } : state,
      questions,
      images: key && image ? [{ key, jpeg_base64: image.toString("base64") }] : undefined,
    });
    for (const id of Object.keys(questions)) checks[id]!.p = res.answers[id] ?? null;
    return { model: res.model, checks, verdict: verdictFrom(checks) };
  } catch (e) {
    // No fabricated verdicts: a failed check is reported as unverified.
    return { model: null, checks, verdict: "unverified" };
  }
}

/** Does the recorded quote match what the supplier page actually shows? */
export function verifyQuote(quote: Quote, screenshot: Buffer, pageText: string) {
  return run(
    {
      task: "An assistant read a supplier product page and recorded the offer below. Check it against the page.",
      recorded_offer: quote,
      page_text_excerpt: pageText.slice(0, 6000),
    },
    {
      product_matches: { instructions: "Is the recorded product the product shown on the page?" },
      price_matches: { instructions: "Does the recorded unit price match the account's price shown on the page for this quantity tier?" },
      stock_matches: { instructions: "Does the recorded quantity available match the stock shown on the page?" },
      lead_time_matches: { instructions: "Does the recorded lead time match the lead time shown on the page?" },
    },
    screenshot,
  );
}

export interface OrderIntent {
  product: string;
  quantity: number;
  ship_to: string;
  budget_usd: number;
  po_number: string;
  expected_total_usd: number;
  supplier: string;
}

/**
 * Before a held order is released: does what is about to be sent match what was approved?
 * Money is checked in code (the decisions model is a fast reader, not a calculator);
 * the model answers the questions that need reading the page and the request.
 */
export async function verifyHeldOrder(intent: OrderIntent, held: HeldRequest, screenshot: Buffer, pageText: string, pageTotal: number | null) {
  const res = await run(
    {
      task: "A purchasing assistant is about to place this order. Compare the checkout page and the outgoing request with the approved intent.",
      approved_intent: { product: intent.product, quantity: intent.quantity, ship_to: intent.ship_to, po_number: intent.po_number, supplier: intent.supplier },
      outgoing_request: { method: held.method, url: held.url, body: held.body_summary },
      checkout_page_text: pageText.slice(0, 6000),
    },
    {
      item_matches: { instructions: "Is the item being ordered the approved product?" },
      quantity_matches: { instructions: "Is the quantity being ordered exactly the approved quantity?" },
      ship_to_matches: { instructions: "Is the shipping address the approved ship-to address?" },
      po_matches: { instructions: "Does the order carry the approved PO number?" },
    },
    screenshot,
  );
  const within = pageTotal === null ? null : pageTotal <= intent.budget_usd + 0.005 ? 1 : 0;
  res.checks.within_budget = {
    p: within,
    question:
      pageTotal === null
        ? "Order total within budget (no total found on the page)"
        : `Order total $${pageTotal.toFixed(2)} within budget $${intent.budget_usd.toFixed(2)} (computed, not estimated)`,
  };
  res.verdict = verdictFrom(res.checks);
  return res;
}

const MONEY = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)/;

/** Find the order total on a checkout page ("Total $2,340.00" and similar). */
const MONEY_ALL = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)/g;
const MONEY_ONLY = /^\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)$/;

/**
 * The amount the budget is checked against: the LARGEST amount on any line of the checkout page
 * that mentions a total ("Subtotal", "Total", "Order total"…), or on the bare-amount line right after
 * a total label. Conservative on purpose: no larger total can hide behind a smaller one. No amount
 * found → null, and the budget check stays unverified for the reviewer.
 */
export function totalFromPage(text: string): number | null {
  const amounts: number[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (!/total/i.test(line)) return;
    const inline = [...line.matchAll(MONEY_ALL)].map((m) => Number(m[1]!.replace(/,/g, "")));
    if (inline.length) amounts.push(...inline);
    else {
      const next = lines[i + 1]?.match(MONEY_ONLY);
      if (next) amounts.push(Number(next[1]!.replace(/,/g, "")));
    }
  });
  return amounts.length ? Math.max(...amounts) : null;
}
