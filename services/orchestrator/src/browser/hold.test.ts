import { describe, it, expect } from "vitest";
import { OrderHold } from "./hold.js";

const fakeReq = (method: string, url: string) => ({ method: () => method, url: () => url }) as any;
const hold = new OrderHold({} as any, [
  { id: "medusa", label: "Place order", host: "northwind.example.test", method: "POST", pathRegex: "^/store/carts/[^/]+/complete$" },
  { id: "woo", label: "Place order", host: "acme.example.test", method: "POST", pathRegex: "^/[?]wc-ajax=checkout$" },
], () => {}, () => {});

describe("OrderHold.match", () => {
  it("matches the order request by host, method and path+query", () => {
    expect(hold.match(fakeReq("POST", "https://northwind.example.test/store/carts/cart_01H/complete"))?.id).toBe("medusa");
    expect(hold.match(fakeReq("POST", "https://acme.example.test/?wc-ajax=checkout"))?.id).toBe("woo");
  });
  it("lets everything else through", () => {
    expect(hold.match(fakeReq("GET", "https://northwind.example.test/store/carts/cart_01H/complete"))).toBeUndefined();
    expect(hold.match(fakeReq("POST", "https://northwind.example.test/store/carts/cart_01H/line-items"))).toBeUndefined();
    expect(hold.match(fakeReq("POST", "https://acme.example.test/?wc-ajax=update_order_review"))).toBeUndefined();
  });
  it("does not match the same path on another host", () => {
    expect(hold.match(fakeReq("POST", "https://elsewhere.example.test/store/carts/cart_01H/complete"))).toBeUndefined();
  });
});

describe("OrderHold normalization and catch-all", () => {
  const h = new OrderHold({} as any, [
    { id: "woo", label: "Place order", host: "acme.example.test", method: "POST", pathRegex: "^/[?](.*&)?wc-ajax=checkout(&.*)?$" },
  ], () => {}, () => {}, 1000, { host: "acme.example.test", safe: ["/[?]wc-ajax=update_order_review", "/[?]wc-ajax=get_refreshed_fragments"] });

  it("matches regardless of query order, case and duplicate slashes", () => {
    expect(h.match(fakeReq("POST", "https://acme.example.test/?x=1&wc-ajax=checkout"))?.id).toBe("woo");
    expect(h.match(fakeReq("POST", "https://ACME.example.test//?WC-AJAX=CHECKOUT"))?.id).toBe("woo");
  });
  it("holds unknown order-like requests to the supplier host (fail closed)", () => {
    expect(h.match(fakeReq("POST", "https://acme.example.test/wp-json/wc/store/v1/checkout"))?.id).toBe("catch-all");
    expect(h.match(fakeReq("PUT", "https://acme.example.test/api/place-order"))?.id).toBe("catch-all");
  });
  it("leaves known-safe and non-order requests alone", () => {
    expect(h.match(fakeReq("POST", "https://acme.example.test/?wc-ajax=update_order_review"))).toBeUndefined();
    expect(h.match(fakeReq("POST", "https://acme.example.test/?wc-ajax=add_to_cart"))).toBeUndefined();
    expect(h.match(fakeReq("GET", "https://acme.example.test/checkout/"))).toBeUndefined();
  });
  it("a safe pattern cannot be smuggled inside another target", () => {
    expect(h.match(fakeReq("POST", "https://acme.example.test/wp-json/wc/store/v1/checkout?x=wc-ajax=update_order_review"))?.id).toBe("catch-all");
  });
  it("normalization survives malformed escapes", () => {
    expect(() => h.match(fakeReq("POST", "https://acme.example.test/%E0%A4%A/checkout"))).not.toThrow();
    expect(h.match(fakeReq("POST", "https://acme.example.test/%E0%A4%A/checkout"))?.id).toBe("catch-all");
  });
});

describe("Medusa checkout steps vs the order endpoint", () => {
  const h = new OrderHold({} as any, [
    { id: "nw", label: "Place order", host: "northwind.example.test", method: "POST", pathRegex: "^/api/checkout/place-order$" },
  ], () => {}, () => {}, 1000, { host: "northwind.example.test", safe: ["/us/checkout([?]step=[a-z-]+)?", "/us/cart"] });
  it("releases the intermediate checkout steps", () => {
    for (const step of ["shipping-address", "billing-address", "delivery", "payment", "review"]) {
      expect(h.match(fakeReq("POST", `https://northwind.example.test/us/checkout?step=${step}`))).toBeUndefined();
    }
  });
  it("holds the order endpoint and unknown order-like endpoints", () => {
    expect(h.match(fakeReq("POST", "https://northwind.example.test/api/checkout/place-order"))?.id).toBe("nw");
    expect(h.match(fakeReq("POST", "https://northwind.example.test/store/carts/c1/complete"))?.id).toBe("catch-all");
  });
});
