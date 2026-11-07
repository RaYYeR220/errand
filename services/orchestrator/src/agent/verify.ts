import { randomUUID } from "node:crypto";
import { parseAddress } from "./address.js";
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
 * What decides where the goods go: street, unit, city and ZIP (pages often leave the company or state out of the summary).
 * The question names the values: the decisions model answers a concrete question far more sharply than "the approved address"
 * (measured on a held checkout: 0.96 with the right address, 0.03 with the suite missing).
 */
export function shipToQuestion(shipTo: string): string {
  const a = parseAddress(shipTo);
  if (!a) return "Is the shipping address on the checkout page the approved ship-to address?";
  return `Is the shipping address on the checkout page ${a.address_1}${a.address_2 ? `, ${a.address_2}` : ""}, ${a.city}, ZIP ${a.zip}?`;
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
      approved_intent: { product: intent.product, quantity: intent.quantity, ship_to: intent.ship_to, ship_to_fields: parseAddress(intent.ship_to) ?? undefined, po_number: intent.po_number, supplier: intent.supplier },
      outgoing_request: { method: held.method, url: held.url, body: held.body_summary },
      checkout_page_text: pageText.slice(0, 6000),
    },
    {
      item_matches: { instructions: "Is the item being ordered the approved product?" },
      quantity_matches: { instructions: "Is the quantity being ordered exactly the approved quantity?" },
      ship_to_matches: { instructions: shipToQuestion(intent.ship_to) },
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

const AMOUNT = String.raw`\$ ?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{2})?)`;
const LABEL = String.raw`[A-Za-z][A-Za-z ()./&-]*`;
/** "Total $2,340.00", "Order total: $989.50", "Total (incl. freight) $2,999.00" — and nothing else. */
const TOTAL_LINE = new RegExp(String.raw`^${LABEL}:? ?${AMOUNT}$`);
const LABEL_ONLY = new RegExp(String.raw`^${LABEL}:?$`);
const BARE_AMOUNT = new RegExp(String.raw`^${AMOUNT}$`);

/**
 * The amount the budget is checked against, read from the checkout page.
 *
 * Every line that mentions a total must be exactly "label amount", or a label alone followed by a
 * line that is exactly an amount. The LARGEST such amount wins, so no larger total can hide behind a
 * smaller one. Any other line that mentions a total — another currency, extra numbers or words after
 * the amount, a label with nothing usable after it — makes the page ambiguous: the answer is null and
 * the budget check is left to the reviewer.
 */
export function totalFromPage(text: string): number | null {
  const amounts: number[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/total/i.test(line)) continue;
    const inline = line.match(TOTAL_LINE);
    if (inline) {
      amounts.push(Number(inline[1]!.replace(/,/g, "")));
      continue;
    }
    const next = lines[i + 1];
    const bare = LABEL_ONLY.test(line) && next ? next.match(BARE_AMOUNT) : null;
    if (!bare) return null;
    amounts.push(Number(bare[1]!.replace(/,/g, "")));
    i++;
  }
  return amounts.length ? Math.max(...amounts) : null;
}
