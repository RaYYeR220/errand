import { describe, it, expect } from "vitest";
import type { Quote } from "@errand/shared";
import { referenceCompute } from "./compute.js";

const req = { product_category: "dock", quantity: 12, budget_usd: 2400, deadline_business_days: 3, min_power_delivery_w: 90, min_external_4k_displays: 2, ship_to: "HQ", must_haves: [] };
const q = (o: Partial<Quote>): Quote => ({ supplier: "s", product: "p", unit_price_usd: 100, quantity_available: 50, lead_time_business_days: 2, shipping_usd: 0, power_delivery_w: 100, external_4k_displays: 2, url: "https://x", ...o });

describe("referenceCompute", () => {
  it("applies the best volume tier for the quantity", () => {
    const r = referenceCompute([q({ unit_price_usd: 180, volume_tiers: [{ min_qty: 10, unit_price_usd: 165 }, { min_qty: 25, unit_price_usd: 150 }] })], req);
    expect(r.candidates[0]!.unit_price_usd).toBe(165);
    expect(r.candidates[0]!.total_usd).toBe(1980);
  });

  it("lowest unit price is not the winner when it misses the deadline", () => {
    const r = referenceCompute([q({ supplier: "cheap", unit_price_usd: 120, lead_time_business_days: 7 }), q({ supplier: "fast", unit_price_usd: 140, shipping_usd: 25 })], req);
    expect(r.winner?.supplier).toBe("fast");
    expect(r.candidates.find((c) => c.supplier === "cheap")!.reasons.join()).toMatch(/lead time/);
  });

  it("shipping can flip the ranking", () => {
    const r = referenceCompute([q({ supplier: "a", unit_price_usd: 150, shipping_usd: 120 }), q({ supplier: "b", unit_price_usd: 158, shipping_usd: 0 })], req);
    expect(r.winner?.supplier).toBe("b");
  });

  it("rejects specs, stock and budget failures and returns no winner when nothing fits", () => {
    const r = referenceCompute([
      q({ supplier: "w", power_delivery_w: 65 }),
      q({ supplier: "d", external_4k_displays: 1 }),
      q({ supplier: "s", quantity_available: 4 }),
      q({ supplier: "b", unit_price_usd: 300 }),
    ], req);
    expect(r.winner).toBeNull();
    expect(r.candidates.every((c) => !c.eligible)).toBe(true);
  });
});
