#!/usr/bin/env python3
"""End-to-end smoke test of the supplier portals.

For every supplier in suppliers.json, drives a real browser through the buyer
journey and checks it against catalog/catalog.json:

  guest sees the list price -> sign in -> contract price, stock, lead time and
  volume tiers are shown -> add 12 units -> checkout with PO number, cost
  center and ship-to -> place the order -> the order is visible in the
  supplier's admin/API with the PO details

It also records the browser request that placed the order and checks it
against the supplier's `order_request` patterns, lists cookies readable by
page JavaScript and every third-party host contacted.

Usage:
  python scripts/smoke.py                      # all suppliers, headless
  python scripts/smoke.py --supplier acme --headed
Requires: pip install -r scripts/requirements.txt && playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from playwright.sync_api import Browser, BrowserContext, Page, Request, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "smoke-artifacts"
QUANTITY = 12
PRODUCT_KEY = "dell-wd19s-130w"
SHIP_TO = {
    "first_name": "Receiving",
    "last_name": "Dock 4",
    "company": "Lumen Labs",
    "address_1": "1500 Harbor Way",
    "address_2": "Loading Dock 4",
    "city": "Oakland",
    "province": "CA",
    "postal_code": "94607",
    "phone": "+1 510 555 0199",
}


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def money(value: float) -> str:
    return f"${value:,.2f}"


def uses_local_ca(env: dict[str, str]) -> bool:
    """True when the edge issues certificates from Caddy's local CA."""
    return "local_certs" in env.get("CADDY_GLOBAL_OPTIONS", "")


def tls_context(env: dict[str, str]) -> ssl.SSLContext:
    """Verifying TLS context; trusts Caddy's local root CA in development."""
    if not uses_local_ca(env):
        return ssl.create_default_context()
    root = ARTIFACTS / "caddy-local-root.crt"
    certificate = subprocess.run(
        ["docker", "compose", "exec", "-T", "edge", "cat", "/data/caddy/pki/authorities/local/root.crt"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    root.write_text(certificate, encoding="utf-8")
    return ssl.create_default_context(cafile=str(root))


@dataclass
class Result:
    supplier: str
    steps: list[tuple[str, bool, str]] = field(default_factory=list)
    order_request: dict | None = None
    order_id: str | None = None
    js_cookies: list[str] = field(default_factory=list)
    foreign_hosts: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return bool(self.steps) and all(passed for _, passed, _ in self.steps)

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.steps.append((name, bool(condition), detail))
        mark = "PASS" if condition else "FAIL"
        print(f"  [{mark}] {name}{f' - {detail}' if detail else ''}", flush=True)
        if not condition:
            raise AssertionError(f"{name}: {detail}")


class Recorder:
    """Collects every request a context makes."""

    def __init__(self) -> None:
        self.requests: list[Request] = []

    def attach(self, context: BrowserContext) -> None:
        context.on("request", lambda request: self.requests.append(request))

    def hosts(self) -> set[str]:
        return {urlsplit(r.url).hostname or "" for r in self.requests if r.url.startswith("http")}


def path_with_query(url: str) -> str:
    parts = urlsplit(url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


def matching_order_request(requests: list[Request], host: str, patterns: list[dict]) -> Request | None:
    for request in requests:
        if urlsplit(request.url).hostname != host:
            continue
        for pattern in patterns:
            if request.method == pattern["method"] and re.search(pattern["path_regex"], path_with_query(request.url)):
                return request
    return None


def js_readable_cookies(context: BrowserContext, host: str) -> list[str]:
    return sorted(
        {c["name"] for c in context.cookies() if not c["httpOnly"] and host.endswith(c["domain"].lstrip("."))}
    )


# --------------------------------------------------------------------------- Northwind


def run_northwind(browser: Browser, supplier: dict, env: dict, catalog: dict, result: Result) -> None:
    base = supplier["base_url"]
    host = urlsplit(base).hostname
    offer = catalog["suppliers"]["northwind"]["offers"][PRODUCT_KEY]
    tier_price = offer["tiers"][0]["price"]
    product_url = f"{base}/us/products/{PRODUCT_KEY}"

    context = browser.new_context(ignore_https_errors=uses_local_ca(env), viewport={"width": 1440, "height": 1000})
    recorder = Recorder()
    recorder.attach(context)
    page = context.new_page()
    try:
        page.goto(product_url)
        price = page.get_by_test_id("product-container").get_by_test_id("product-price").first
        expect(price).to_be_visible()
        result.check(
            "guest sees list price",
            price.get_attribute("data-price-type") == "list"
            and float(price.get_attribute("data-value")) == offer["list_price"],
            f"{price.inner_text().strip()} (list {money(offer['list_price'])})",
        )

        page.goto(supplier["login_url"])
        page.get_by_test_id("email-input").fill(supplier["accounts"][0]["username"])
        page.get_by_test_id("password-input").fill(env[supplier["accounts"][0]["password_env"]])
        page.get_by_test_id("sign-in-button").click()
        expect(page.get_by_test_id("sign-in-button")).to_have_count(0, timeout=30_000)
        result.check("buyer signs in", True, supplier["accounts"][0]["username"])

        page.goto(product_url)
        container = page.get_by_test_id("product-container")
        price = container.get_by_test_id("product-price").first
        expect(price).to_have_attribute("data-price-type", "contract")
        result.check(
            "contract price visible",
            float(price.get_attribute("data-value")) == offer["contract_price"],
            f"{price.inner_text().strip()} (contract {money(offer['contract_price'])})",
        )
        stock = int(page.get_by_test_id("product-stock").get_attribute("data-value"))
        lead = int(page.get_by_test_id("product-lead-time").get_attribute("data-value"))
        tiers = page.get_by_test_id("volume-tiers").inner_text()
        result.check(
            "stock, lead time and tiers shown",
            stock >= QUANTITY and lead == offer["lead_time_days"] and money(tier_price) in tiers,
            f"stock {stock}, lead {lead} d, 10+ tier {money(tier_price)}",
        )

        page.wait_for_load_state("networkidle")
        add = container.get_by_test_id("add-product-button").first
        for _ in range(3):  # the quantity input only reacts once hydrated
            container.locator("input").first.fill(str(QUANTITY))
            if add.is_enabled():
                break
            page.wait_for_timeout(1000)
        # Adding is optimistic in the UI; wait for the server action's response.
        with page.expect_response(
            lambda response: response.request.method == "POST" and "next-action" in response.request.headers
        ):
            add.click()
        subtotal = round(tier_price * QUANTITY, 2)
        for _ in range(10):
            page.goto(f"{base}/us/cart")
            cart = page.get_by_test_id("cart-container")
            expect(cart).to_be_visible()
            if money(subtotal) in cart.inner_text():
                break
            page.wait_for_timeout(1000)
        expect(page.get_by_test_id("cart-container")).to_contain_text(money(subtotal))
        result.check("12 units in cart at tier price", True, f"{QUANTITY} x {money(tier_price)} = {money(subtotal)}")

        page.get_by_test_id("checkout-button").click()
        page.wait_for_url(re.compile(r"/us/checkout"))
        po_number, cost_center = f"PO-SMOKE-{int(time.time())}", "CC-4410-IT"
        complete_northwind_checkout(page, po_number, cost_center, result)

        cart_cookies = js_readable_cookies(context, host)
        before = len(recorder.requests)
        page.get_by_test_id("submit-order-button").click()
        page.wait_for_url(re.compile(r"/us/order/confirmed/(order_[A-Z0-9]+)"), timeout=60_000)
        order_id = re.search(r"/order/confirmed/(order_[A-Z0-9]+)", page.url).group(1)
        placed = matching_order_request(recorder.requests[before:], host, supplier["order_request"])
        result.check(
            "order placed",
            placed is not None,
            f"{order_id} via {placed.method} {path_with_query(placed.url)}" if placed else "no matching request",
        )
        result.order_id = order_id
        result.order_request = {"method": placed.method, "path": path_with_query(placed.url)}
        expect(page.get_by_test_id("order-po-number")).to_have_text(po_number)

        verify_northwind_order(supplier, env, order_id, po_number, cost_center, subtotal, result)
        result.js_cookies = sorted(set(cart_cookies) | set(js_readable_cookies(context, host)))
        result.foreign_hosts = sorted(recorder.hosts() - {host})
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "northwind-failure.png"), full_page=True)
        raise
    finally:
        context.close()


def complete_northwind_checkout(page: Page, po_number: str, cost_center: str, result: Result) -> None:
    """Ship-to (receiving dock), bill-to (company HQ), delivery, PO details, invoice payment."""
    ship_fields = {
        "first-name": SHIP_TO["first_name"],
        "last-name": SHIP_TO["last_name"],
        "phone": SHIP_TO["phone"],
        "company": SHIP_TO["company"],
        "address": SHIP_TO["address_1"],
        "postal-code": SHIP_TO["postal_code"],
        "city": SHIP_TO["city"],
        "province": SHIP_TO["province"],
    }
    for name, value in ship_fields.items():
        page.get_by_test_id(f"shipping-{name}-input").fill(value)
    page.get_by_test_id("shipping-country-select").select_option("us")
    page.get_by_test_id("submit-address-button").click()
    page.wait_for_url(re.compile(r"step=billing-address"))

    bill_fields = {
        "first-name": "Dana",
        "last-name": "Okafor",
        "phone": "+1 510 555 0142",
        "company": "Lumen Labs",
        "address": "1450 Harbor Way",
        "postal-code": "94607",
        "city": "Oakland",
        "province": "CA",
    }
    for name, value in bill_fields.items():
        page.get_by_test_id(f"billing-{name}-input").fill(value)
    page.get_by_test_id("billing-country-select").select_option("us")
    page.get_by_test_id("submit-address-button").click()
    page.wait_for_url(re.compile(r"step=delivery"))

    page.get_by_test_id("delivery-option-radio").first.click()
    page.get_by_test_id("submit-delivery-option-button").click()
    page.wait_for_url(re.compile(r"step=contact-details"))

    page.get_by_test_id("po-number-input").fill(po_number)
    page.get_by_test_id("cost-center-input").fill(cost_center)
    page.get_by_test_id("submit-address-button").click()
    page.wait_for_url(re.compile(r"step=payment"))

    page.get_by_test_id("radio-button").first.click()
    page.get_by_test_id("submit-payment-button").click()
    page.wait_for_url(re.compile(r"step=review"))
    expect(page.get_by_test_id("po-number-summary")).to_contain_text(po_number)
    result.check(
        "checkout filled",
        True,
        f"ship-to {SHIP_TO['address_1']}; PO {po_number}; cost center {cost_center}; invoice net 30",
    )


def verify_northwind_order(
    supplier: dict, env: dict, order_id: str, po_number: str, cost_center: str, subtotal: float, result: Result
) -> None:
    """Reads the order back through the Medusa admin API."""
    api = supplier["base_url"].replace("://northwind.", "://api.northwind.")
    tls = tls_context(env)

    def call(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
        headers = {"content-type": "application/json"}
        if token:
            headers["authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"{api}{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        with urllib.request.urlopen(request, context=tls, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    credentials = {"email": env["NORTHWIND_ADMIN_EMAIL"], "password": env["NORTHWIND_ADMIN_PASSWORD"]}
    token = call("POST", "/auth/user/emailpass", credentials)["token"]
    fields = "%2Bmetadata,%2Bitem_total,*items,*shipping_address"
    order = call("GET", f"/admin/orders/{order_id}?fields={fields}", token=token)["order"]
    item = order["items"][0]
    metadata = order.get("metadata") or {}
    result.check(
        "order visible in admin API",
        metadata.get("po_number") == po_number
        and metadata.get("cost_center") == cost_center
        and item["quantity"] == QUANTITY
        and round(float(order["item_total"]), 2) == subtotal
        and order["shipping_address"]["address_1"] == SHIP_TO["address_1"],
        f"#{order['display_id']} {item['quantity']} x {money(float(item['unit_price']))}, "
        f"PO {metadata.get('po_number')}, cost center {metadata.get('cost_center')}, "
        f"ship-to {order['shipping_address']['address_1']}",
    )


# --------------------------------------------------------------------------- Acme


def run_acme(browser: Browser, supplier: dict, env: dict, catalog: dict, result: Result) -> None:
    base = supplier["base_url"]
    host = urlsplit(base).hostname
    data = catalog["suppliers"]["acme"]
    offer = data["offers"][PRODUCT_KEY]
    tier_price = offer["tiers"][0]["price"]
    subtotal = round(tier_price * QUANTITY, 2)
    free = subtotal >= data["shipping"]["free_threshold"]
    shipping = 0.0 if free else round(data["shipping"]["rate"] * QUANTITY, 2)
    total = round(subtotal + shipping, 2)
    product_url = f"{base}/product/{PRODUCT_KEY}/"
    po_number, cost_center = f"PO-SMOKE-{int(time.time())}", "CC-4410-IT"

    context = browser.new_context(ignore_https_errors=uses_local_ca(env), viewport={"width": 1440, "height": 1000})
    recorder = Recorder()
    recorder.attach(context)
    page = context.new_page()
    try:
        page.goto(product_url)
        price = page.locator(".summary .price").first.inner_text().strip()
        expect(page.get_by_test_id("contract-pricing-hint")).to_be_visible()
        result.check(
            "guest sees list price",
            price == money(offer["list_price"]),
            f"{price} (list {money(offer['list_price'])})",
        )

        page.goto(supplier["login_url"])
        page.fill("#username", supplier["accounts"][0]["username"])
        page.fill("#password", env[supplier["accounts"][0]["password_env"]])
        page.click("button[name=login]")
        expect(page.locator(".woocommerce-MyAccount-navigation")).to_be_visible()
        result.check("buyer signs in", True, supplier["accounts"][0]["username"])

        # The cart persists per account; start from an empty one.
        for _ in range(10):
            page.goto(f"{base}/cart/")
            remove = page.locator("td.product-remove a.remove")
            if not remove.count():
                break
            page.goto(remove.first.get_attribute("href"))
        expect(page.locator("td.product-remove a.remove")).to_have_count(0)

        page.goto(product_url)
        price = page.locator(".summary .price").first
        current = price.locator("ins").inner_text().strip()
        listed = price.locator("del").inner_text().strip()
        result.check(
            "contract price visible",
            "contract price" in price.inner_text().lower()
            and current == money(offer["contract_price"])
            and listed == money(offer["list_price"]),
            f"{current} (list {listed} struck through)",
        )
        stock = int(page.get_by_test_id("product-stock").get_attribute("data-value"))
        lead = int(page.get_by_test_id("product-lead-time").get_attribute("data-value"))
        tiers = page.get_by_test_id("volume-tiers").inner_text()
        result.check(
            "stock, lead time and tiers shown",
            stock >= QUANTITY and lead == offer["lead_time_days"] and money(tier_price) in tiers,
            f"stock {stock}, lead {lead} d, 10+ tier {money(tier_price)}",
        )

        page.fill("input.qty", str(QUANTITY))
        page.click("button[name=add-to-cart]")
        expect(page.locator(".woocommerce-message")).to_contain_text("added to your cart")

        page.goto(f"{base}/checkout/")
        page.wait_for_load_state("networkidle")
        review = page.locator("#order_review")
        expect(review).to_contain_text(money(subtotal))
        expect(review).to_contain_text(money(total))
        result.check(
            "12 units in cart at tier price",
            True,
            f"{QUANTITY} x {money(tier_price)} = {money(subtotal)}, shipping {money(shipping)}, total {money(total)}",
        )

        ship_to_toggle = page.locator("#ship-to-different-address-checkbox")
        if not ship_to_toggle.is_checked():
            ship_to_toggle.check()
        for key in ("first_name", "last_name", "company", "address_1", "address_2", "city", "phone"):
            page.fill(f"#shipping_{key}", SHIP_TO[key])
        page.fill("#shipping_postcode", SHIP_TO["postal_code"])
        page.fill("#po_number", po_number)
        page.fill("#cost_center", cost_center)
        expect(page.locator("#payment_method_cheque")).to_be_checked()
        page.wait_for_load_state("networkidle")
        result.check(
            "checkout filled",
            True,
            f"ship-to {SHIP_TO['address_1']}, {SHIP_TO['address_2']}; PO {po_number}; cost center {cost_center}; invoice net 30",
        )

        cart_cookies = js_readable_cookies(context, host)
        before = len(recorder.requests)
        page.click("#place_order")
        page.wait_for_url(re.compile(r"/checkout/order-received/\d+/"), timeout=60_000)
        order_id = re.search(r"/order-received/(\d+)/", page.url).group(1)
        placed = matching_order_request(recorder.requests[before:], host, supplier["order_request"])
        result.check(
            "order placed",
            placed is not None,
            f"#{order_id} via {placed.method} {path_with_query(placed.url)}" if placed else "no matching request",
        )
        result.order_id = order_id
        result.order_request = {"method": placed.method, "path": path_with_query(placed.url)}
        result.js_cookies = sorted(set(cart_cookies) | set(js_readable_cookies(context, host)))
        result.foreign_hosts = sorted(recorder.hosts() - {host})

        verify_acme_order(browser, supplier, env, order_id, po_number, cost_center, total, result)
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "acme-failure.png"), full_page=True)
        raise
    finally:
        context.close()


def verify_acme_order(
    browser: Browser,
    supplier: dict,
    env: dict,
    order_id: str,
    po_number: str,
    cost_center: str,
    total: float,
    result: Result,
) -> None:
    """Opens the order in wp-admin as the store administrator."""
    base = supplier["base_url"]
    context = browser.new_context(ignore_https_errors=uses_local_ca(env), viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    try:
        page.goto(f"{base}/wp-login.php")
        page.fill("#user_login", env.get("ACME_ADMIN_USER", "acme-admin"))
        page.fill("#user_pass", env["ACME_ADMIN_PASSWORD"])
        page.click("#wp-submit")
        page.wait_for_url(re.compile(r"/wp-admin/"))
        page.goto(f"{base}/wp-admin/admin.php?page=wc-orders&action=edit&id={order_id}")
        order = page.locator("#order_data")
        expect(order).to_contain_text(po_number)
        details = order.inner_text()
        items = page.locator("#woocommerce-order-items").inner_text()
        result.check(
            "order visible in admin",
            cost_center in details and SHIP_TO["address_1"] in details and money(total) in items,
            f"#{order_id}, PO {po_number}, cost center {cost_center}, ship-to {SHIP_TO['address_1']}, total {money(total)}",
        )
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "acme-admin-failure.png"), full_page=True)
        raise
    finally:
        context.close()


# --------------------------------------------------------------------------- manifest


def check_manifest(supplier: dict, result: Result) -> None:
    """Observed cookies and hosts must be declared in suppliers.json."""
    undeclared_cookies = set(result.js_cookies) - set(supplier["js_readable_cookies"])
    result.check(
        "JS-readable cookies declared",
        not undeclared_cookies,
        f"observed {', '.join(result.js_cookies) or 'none'}"
        + (f"; undeclared {', '.join(sorted(undeclared_cookies))}" if undeclared_cookies else ""),
    )
    undeclared_hosts = set(result.foreign_hosts) - set(supplier["asset_hosts"])
    result.check(
        "asset hosts declared",
        not undeclared_hosts,
        f"observed {', '.join(result.foreign_hosts) or 'none'}"
        + (f"; undeclared {', '.join(sorted(undeclared_hosts))}" if undeclared_hosts else ""),
    )


# --------------------------------------------------------------------------- main


RUNNERS: dict[str, Callable] = {"northwind": run_northwind, "acme": run_acme}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--supplier", action="append", help="supplier id (repeatable); default: all")
    parser.add_argument("--headed", action="store_true", help="show the browser")
    args = parser.parse_args()

    env = load_env(ROOT / ".env")
    catalog = json.loads((ROOT / "catalog" / "catalog.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "suppliers.json").read_text(encoding="utf-8"))
    ARTIFACTS.mkdir(exist_ok=True)

    suppliers = []
    for entry in manifest["suppliers"]:
        if args.supplier and entry["id"] not in args.supplier:
            continue
        entry = json.loads(json.dumps(entry).replace("{BASE_DOMAIN}", env["BASE_DOMAIN"]))
        suppliers.append(entry)

    results: list[Result] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not args.headed)
        for supplier in suppliers:
            print(f"\n== {supplier['name']} ({supplier['base_url']})", flush=True)
            result = Result(supplier["id"])
            results.append(result)
            try:
                RUNNERS[supplier["id"]](browser, supplier, env, catalog, result)
                check_manifest(supplier, result)
            except Exception as error:  # noqa: BLE001 - reported in the summary
                if not result.steps or result.steps[-1][1]:
                    result.steps.append(("unexpected error", False, f"{type(error).__name__}: {error}"))
                    print(f"  [FAIL] unexpected error - {type(error).__name__}: {error}", flush=True)
        browser.close()

    print("\n== Summary")
    for result in results:
        status = "GREEN" if result.ok else "RED"
        print(f"{result.supplier:<10} {status}")
        if result.order_request:
            print(f"  order request : {result.order_request['method']} {result.order_request['path']}")
        if result.order_id:
            print(f"  order         : {result.order_id}")
        if result.ok:
            print(f"  JS cookies    : {', '.join(result.js_cookies) or 'none'}")
            print(f"  other hosts   : {', '.join(result.foreign_hosts) or 'none'}")
    (ARTIFACTS / "report.json").write_text(
        json.dumps(
            [
                {
                    "supplier": r.supplier,
                    "ok": r.ok,
                    "steps": [{"name": n, "ok": p, "detail": d} for n, p, d in r.steps],
                    "order_request": r.order_request,
                    "order_id": r.order_id,
                    "js_readable_cookies": r.js_cookies,
                    "foreign_hosts": r.foreign_hosts,
                }
                for r in results
            ],
            indent=2,
        ),
        encoding="utf-8",
    )
    return 0 if results and all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
