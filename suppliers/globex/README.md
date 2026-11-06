# Globex (reserved)

Slot for the third supplier, **Globex**. The platform is not chosen yet.

Reserved so far:

- Hostname `globex.<BASE_DOMAIN>` (commented in `edge/Caddyfile`).
- Supplier id `globex` for `suppliers.json`.
- Offers for the shared catalog go under `suppliers.globex` in `catalog/catalog.json`, using the same shape as `northwind` and `acme` (`sku`, `list_price`, `contract_price`, `tiers`, `stock`, `lead_time_days`, plus a `shipping` block).

To add Globex:

1. Put the platform's build context and seed in this directory and add its services to `docker-compose.yml` (prefix them `globex-`, publish the web port on `127.0.0.1` only).
2. Add a `globex.{$BASE_DOMAIN}` site block to `edge/Caddyfile`.
3. Seed the Lumen Labs buyer with a random password in `.env` (`GLOBEX_BUYER_PASSWORD`, listed in `.env.example`), and the same five docks with contract pricing and a 10+ volume tier.
4. Add the entry to `suppliers.json` and a runner to `scripts/smoke.py`, then record the observed order-placement request.
5. Re-run `python scripts/reference_task.py`: the reference task must still have exactly one correct answer.
