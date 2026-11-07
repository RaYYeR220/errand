import { describe, it, expect } from "vitest";
import { parseAddress, checkoutAddressInstructions } from "./address.js";

describe("parseAddress", () => {
  it("splits an address with a suite", () => {
    expect(parseAddress("Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105")).toEqual({
      company: "Lumen Labs",
      address_1: "500 Market St",
      address_2: "Suite 400",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "United States",
    });
  });
  it("splits an address without a unit", () => {
    expect(parseAddress("Lumen Labs Warehouse, 2200 Harbor Blvd, Oakland, CA 94607")).toMatchObject({
      company: "Lumen Labs Warehouse",
      address_1: "2200 Harbor Blvd",
      address_2: "",
      city: "Oakland",
      zip: "94607",
    });
  });
  it("refuses shapes it cannot split with certainty", () => {
    expect(parseAddress("HQ")).toBeNull();
    expect(parseAddress("Lumen Labs, 500 Market St, San Francisco, California 94105")).toBeNull();
    expect(parseAddress("Lumen Labs, 500 Market St, Building B, San Francisco, CA 94105")).toBeNull();
  });
});

describe("checkoutAddressInstructions", () => {
  it("lists every field with the buyer's contact", () => {
    const s = checkoutAddressInstructions("Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105", { first_name: "Sam", last_name: "Rivera", phone: "+1 510 555 0143" });
    expect(s).toContain('first name "Sam"');
    expect(s).toContain('address "500 Market St, Suite 400"');
    expect(s).toContain('state / province "CA"');
    expect(s).toContain('ZIP / postal code "94105"');
  });
  it("falls back to the line as given", () => {
    expect(checkoutAddressInstructions("HQ")).toBe("ship to HQ");
  });
});
