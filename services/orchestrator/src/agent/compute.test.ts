import { describe, it, expect } from "vitest";
import type { Quote } from "@errand/shared";
import { referenceCompute } from "./compute.js";

const req = { product_category: "dock", quantity: 12, budget_usd: 2400, deadline_business_days: 3, min_power_delivery_w: 90, min_external_4k_displays: 2, ship_to: "HQ", must_haves: [] };
const q = (o: Partial<Quote>): Quote => ({ supplier: "s", product: "p", unit_price_usd: 100, quantity_available: 50, lead_time_business_days: 2, shipping_per_order_usd: 0, shipping_per_unit_usd: 0, free_shipping_threshold_usd: 0, power_delivery_w: 100, external_4k_displays: 2, url: "https://x", ...o });

describe("referenceCompute", () => {
  it("applies the best volume tier for the quantity", () => {
    const r = referenceCompute([q({ unit_price_usd: 180, volume_tiers: [{ min_qty: 10, unit_price_usd: 165 }, { min_qty: 25, unit_price_usd: 150 }] })], req);
    expect(r.candidates[0]!.unit_price_usd).toBe(165);
    expect(r.candidates[0]!.total_usd).toBe(1980);
  });

  it("lowest unit price is not the winner when it misses the deadline", () => {
    const r = referenceCompute([q({ supplier: "cheap", unit_price_usd: 120, lead_time_business_days: 7 }), q({ supplier: "fast", unit_price_usd: 140, shipping_per_order_usd: 25 })], req);
    expect(r.winner?.supplier).toBe("fast");
    expect(r.candidates.find((c) => c.supplier === "cheap")!.reasons.join()).toMatch(/lead time/);
  });

  it("shipping can flip the ranking", () => {
    const r = referenceCompute([q({ supplier: "a", unit_price_usd: 150, shipping_per_unit_usd: 10 }), q({ supplier: "b", unit_price_usd: 158 })], req);
    expect(r.winner?.supplier).toBe("b");
  });

  it("reproduces the supplier network's reference answer", () => {
    const nw = { shipping_per_order_usd: 49, shipping_per_unit_usd: 0, free_shipping_threshold_usd: 2000 };
    const ac = { shipping_per_order_usd: 0, shipping_per_unit_usd: 12.5, free_shipping_threshold_usd: 3000 };
    const r = referenceCompute([
      q({ supplier: "northwind", product: "Dell WD19S 130W", unit_price_usd: 209, volume_tiers: [{ min_qty: 10, unit_price_usd: 195 }], lead_time_business_days: 2, power_delivery_w: 90, ...nw }),
      q({ supplier: "acme", product: "Dell WD19S 130W", unit_price_usd: 199, volume_tiers: [{ min_qty: 10, unit_price_usd: 189 }], lead_time_business_days: 1, power_delivery_w: 90, ...ac }),
      q({ supplier: "acme", product: "Plugable UD-ULTC4K", unit_price_usd: 185, volume_tiers: [{ min_qty: 10, unit_price_usd: 179 }], lead_time_business_days: 6, ...ac }),
      q({ supplier: "northwind", product: "Plugable UD-ULTC4K", unit_price_usd: 199, volume_tiers: [{ min_qty: 10, unit_price_usd: 192 }], lead_time_business_days: 4, ...nw }),
      q({ supplier: "acme", product: "Anker 563", unit_price_usd: 129, volume_tiers: [{ min_qty: 10, unit_price_usd: 121 }], external_4k_displays: 1, ...ac }),
      q({ supplier: "northwind", product: "Lenovo 40AY", unit_price_usd: 169, volume_tiers: [{ min_qty: 10, unit_price_usd: 159 }], lead_time_business_days: 5, power_delivery_w: 65, ...nw }),
    ], req);
    expect(r.winner).toMatchObject({ supplier: "northwind", product: "Dell WD19S 130W", total_usd: 2340, shipping_usd: 0 });
    expect(r.candidates.find((c) => c.supplier === "acme" && c.product === "Dell WD19S 130W")!.total_usd).toBe(2418);
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
