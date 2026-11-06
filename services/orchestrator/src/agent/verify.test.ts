import { describe, it, expect } from "vitest";
import { totalFromPage } from "./verify.js";

describe("totalFromPage", () => {
  it("reads the order total and ignores subtotals and unit prices", () => {
    const page = ["Subtotal $2,340.00", "Shipping Free", "Tax $0.00", "Total $2,340.00", "12 x $195.00 per unit"].join("\n");
    expect(totalFromPage(page)).toBe(2340);
  });
  it("handles totals without thousands separators", () => {
    expect(totalFromPage("Order total: $989.50")).toBe(989.5);
  });
  it("returns null when no total is shown", () => {
    expect(totalFromPage("Checkout\nShipping address\nContinue")).toBeNull();
  });
});
