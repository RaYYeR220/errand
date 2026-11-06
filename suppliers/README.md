# Suppliers

Two office-hardware suppliers that sell the same five docking stations to business buyers, each on real open-source commerce software:

| Supplier | Platform | Storefront | Admin |
|---|---|---|---|
| **Northwind Supply** | Medusa v2 with the [Medusa B2B starter](https://github.com/medusajs/b2b-starter-medusa) (backend + Next.js storefront) | `https://northwind.<BASE_DOMAIN>` | `https://api.northwind.<BASE_DOMAIN>/app` |
| **Acme Office & Tech** | WordPress + WooCommerce, Storefront theme, classic shortcode checkout | `https://acme.<BASE_DOMAIN>` | `https://acme.<BASE_DOMAIN>/wp-admin/` |
| **Globex** | not chosen yet, see [globex/README.md](globex/README.md) | `globex.<BASE_DOMAIN>` reserved | |

Both stores have the buyer company **Lumen Labs** with one buyer account. Signed in, the buyer sees contract prices and a 10+ volume tier; guests see list prices. Checkout takes a PO number, a cost center and a ship-to address, and pays by invoice on net-30 terms (no payment provider). The order lands in the supplier's admin for fulfilment.

`suppliers.json` describes each supplier for automated buyers: URLs, account, the request that places an order, cookies the storefront's JavaScript reads and third-party asset hosts.

## Run

Requirements: Docker with Compose v2. Ports 80 and 443 free (or change `HTTP_PORT`/`HTTPS_PORT`).

```bash
scripts/init-env.sh            # once: creates .env with random passwords and secrets
docker compose up -d --build   # first build takes a few minutes
scripts/seed.sh                # catalog, pricing, accounts; safe to re-run
```

`scripts/seed.sh` is idempotent: it updates records in place, resets stock to the catalog numbers and rebuilds the contract price lists. Seed one supplier with `scripts/seed.sh northwind` or `scripts/seed.sh acme`.

Stop with `docker compose down`; add `-v` to delete the databases.

### Hostnames

All hostnames derive from `BASE_DOMAIN`:

| Host | Service |
|---|---|
| `northwind.<BASE_DOMAIN>` | Northwind storefront (Next.js) |
| `api.northwind.<BASE_DOMAIN>` | Northwind Medusa API; admin dashboard at `/app` |
| `acme.<BASE_DOMAIN>` | Acme WordPress/WooCommerce |

- **Locally:** `BASE_DOMAIN=localtest.me` (every `*.localtest.me` name resolves to 127.0.0.1). Caddy issues certificates from its own local CA (`CADDY_GLOBAL_OPTIONS=local_certs`), so browsers need to trust that CA or ignore certificate errors.
- **On a VM:** `BASE_DOMAIN=<public-ip>.sslip.io` and `CADDY_GLOBAL_OPTIONS=email you@example.com`; Caddy gets Let's Encrypt certificates for each hostname.
- **Behind an existing proxy:** set `COMPOSE_PROFILES=` (empty) to skip the bundled Caddy and point your proxy at the loopback ports `NORTHWIND_STOREFRONT_PORT` (8100), `NORTHWIND_API_PORT` (9100) and `ACME_PORT` (8200). Forward the original `Host` and `X-Forwarded-Proto`.

No URL is baked into an image: change `BASE_DOMAIN` and run `docker compose up -d` again.

### Environment

`.env.example` lists every variable; `scripts/init-env.sh` copies it to `.env` (git-ignored) and fills each empty value with a random secret.

| Variable | Purpose |
|---|---|
| `BASE_DOMAIN`, `PUBLIC_SCHEME` | Public hostnames and scheme |
| `CADDY_GLOBAL_OPTIONS`, `COMPOSE_PROFILES`, `HTTP_PORT`, `HTTPS_PORT` | Edge proxy |
| `NORTHWIND_STOREFRONT_PORT`, `NORTHWIND_API_PORT`, `ACME_PORT` | Loopback ports for an external proxy |
| `NORTHWIND_DB_PASSWORD`, `NORTHWIND_JWT_SECRET`, `NORTHWIND_COOKIE_SECRET` | Medusa secrets |
| `NORTHWIND_PUBLISHABLE_KEY` | Storefront publishable API key (the seed assigns this token) |
| `NORTHWIND_ADMIN_EMAIL`, `NORTHWIND_ADMIN_PASSWORD` | Medusa admin user |
| `NORTHWIND_BUYER_EMAIL`, `NORTHWIND_BUYER_PASSWORD` | Lumen Labs buyer on Northwind |
| `ACME_DB_PASSWORD`, `ACME_DB_ROOT_PASSWORD`, `ACME_WP_SECRET` | MySQL and WordPress keys/salts |
| `ACME_ADMIN_USER`, `ACME_ADMIN_EMAIL`, `ACME_ADMIN_PASSWORD` | WordPress administrator |
| `ACME_BUYER_USERNAME`, `ACME_BUYER_EMAIL`, `ACME_BUYER_PASSWORD` | Lumen Labs buyer on Acme |

## Catalog

`catalog/catalog.json` is the single source for both stores: product specs, and per supplier the SKU, list price, contract price, volume tiers, stock, lead time and shipping terms. Edit it and re-run `scripts/seed.sh`.

| Model | Dual-display max | Host power | Northwind list / contract / 10+ | Northwind stock, lead | Acme list / contract / 10+ | Acme stock, lead |
|---|---|---:|---|---|---|---|
| CalDigit TS4 Thunderbolt 4 Dock | 2 × 4K @ 60 Hz (2 × 6K on Apple M1 Pro/Max) | 98 W | $399.99 / $335.00 / $319.00 | 26, 2 d | $389.99 / $339.00 / $325.00 | 18, 3 d |
| Dell WD19S 130W USB-C Dock | 2 × 4K @ 60 Hz (HBR3 + DSC host) | 90 W | $289.99 / $209.00 / $195.00 | 48, 2 d | $279.99 / $199.00 / $189.00 | 35, 1 d |
| Lenovo ThinkPad Universal USB-C Dock (40AY) | 2 × 4K @ 60 Hz | 65 W as shipped | $269.99 / $169.00 / $159.00 | 14, 5 d | $259.99 / $165.00 / $158.00 | 9, 7 d |
| Anker 563 USB-C Docking Station (10-in-1) | 4K @ 30 Hz + 2K @ 60 Hz | 100 W | $219.99 / $139.00 / $129.00 | 60, 1 d | $209.99 / $129.00 / $121.00 | 75, 2 d |
| Plugable UD-ULTC4K | 2 × 4K @ 60 Hz (3 × 4K with DP 1.4 hosts) | 100 W | $279.99 / $199.00 / $192.00 | 31, 4 d | $269.99 / $185.00 / $179.00 | 22, 6 d |

Shipping: Northwind charges $49 per order, free from $2,000. Acme charges $12.50 per unit, free from $3,000. Lead times are business days to delivery. Product pages show stock, lead time, shipping terms, the tier table (signed in) and the key specs.

## Reference task

> 12 docks supporting dual 4K displays and at least 90 W power delivery, budget $2,400, must arrive within 3 business days.

Correct answer: **Northwind Supply, Dell WD19S 130W, 12 × $195.00 = $2,340.00 delivered, 2 business days.** The cheapest-looking options fail on specs, lead time or shipping. [EXPECTED.md](EXPECTED.md) has the full table and arithmetic; `python scripts/reference_task.py` recomputes it from the catalog.

## How each store implements B2B

**Northwind (Medusa).** The B2B starter provides companies, employees, approvals and quotes. Lumen Labs is a company linked to a customer group; contract pricing is a `sale` price list scoped to that group, so guests get list prices and the buyer gets contract prices with the list price struck through. Volume tiers are price-list prices with a per-line quantity rule; a workflow hook (`northwind/backend/src/workflows/hooks/volume-pricing.ts`) passes each cart line's quantity to the pricing module, so a tier applies to the line that reaches it. Free shipping is a conditional shipping price on the cart's item total. Payment uses Medusa's built-in manual provider, shown as "Invoice / pay on account (net 30)". The PO number and cost center are stored in cart metadata and carried onto the order.

The upstream starter is pinned to a commit; the Docker builds fetch it and lay the files in `northwind/backend` and `northwind/storefront` over it (`northwind/storefront/tools/prepare-starter.mjs` applies the small text edits). The storefront reads its backend URL, publishable key and public URL at runtime, so one image serves any hostname. The browser only ever talks to the storefront host: all Medusa calls are server-side, session cookies are HttpOnly, and checkout loads no card or wallet SDK.

**Acme (WooCommerce).** One must-use plugin, `acme/mu-plugins/acme-b2b.php`, adds the `business_customer` role, role-based price meta (`_role_price_business_customer`, `_role_tiers_business_customer`), the product-page facts box, the required PO number and cost center checkout fields (saved as `_po_number` and `_cost_center` order meta and shown in wp-admin), and keeps the storefront free of third-party asset hosts. The check-payments gateway is relabelled as invoice on account. `WP_HOME` and `WP_SITEURL` come from the environment, so WordPress only ever answers under the configured hostname. Code lives in the image; the database and uploads are the only persistent state.

## Order placement

The one browser request that commits a purchase on each store (also in `suppliers.json`):

| Supplier | Request | Notes |
|---|---|---|
| Northwind | `POST /api/checkout/place-order` | Every other checkout step is a Next.js server action posted to `/us/checkout?step=…`; placing the order is a dedicated endpoint. Responds with the order id and the confirmation URL. |
| Acme | `POST /?wc-ajax=checkout` | WooCommerce's AJAX checkout. Without JavaScript the form posts to `POST /checkout/` instead. |

Orders are created in a pending/on-hold state for the supplier to fulfil and invoice.

## Smoke test

```bash
pip install -r scripts/requirements.txt && python -m playwright install chromium
python scripts/smoke.py                 # both suppliers, headless
python scripts/smoke.py --supplier acme --headed
```

For each supplier it checks: guest sees the list price, buyer signs in, contract price, stock, lead time and tiers are shown, 12 units go into the cart at the tier price, checkout with PO number, cost center and ship-to, the order is placed, and the order (with PO details) is visible in the admin (Medusa admin API, WooCommerce order screen). It also asserts that the placing request matches `order_request`, and that every cookie readable by page JavaScript and every third-party host it observed is declared in `suppliers.json` (`js_readable_cookies`, `asset_hosts`). Results go to `smoke-artifacts/report.json`, with screenshots on failure.

Each smoke run places real orders, which reserve stock; `scripts/seed.sh` resets available stock to the catalog numbers.

## Layout

```
docker-compose.yml        services, volumes, edge proxy
.env.example              configuration and secrets (copy with scripts/init-env.sh)
catalog/catalog.json      products, offers, shipping terms, buyer company
suppliers.json            machine-readable supplier manifest
EXPECTED.md               reference task and answer
edge/Caddyfile            hostnames and TLS
northwind/backend/        Medusa overlay: config, seed, volume-pricing hooks
northwind/storefront/     Next.js overlay: runtime config, pricing display, PO checkout, place-order endpoint
acme/                     WordPress image, acme-b2b mu-plugin, WP-CLI seed
globex/                   reserved slot
scripts/                  init-env, seed, reference task, smoke test
```
