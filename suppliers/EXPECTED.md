# Reference task and expected answer

## Task

> Buy **12 docks** that support **dual 4K displays** and deliver **at least 90 W** to the laptop. Budget **$2,400** delivered. They must **arrive within 3 business days**.

The buyer is Lumen Labs, signed in to each supplier with its business account, so contract prices and volume tiers apply.

## Answer

**Northwind Supply, Dell WD19S 130W USB-C Dock (SKU NW-DEL-WD19S-130): 12 × $195.00 = $2,340.00, free shipping, delivered in 2 business days.**

It is the only supplier/model that meets every constraint.

## Rules used

- **Unit price:** the contract price, or the volume-tier price once the cart line reaches the tier (all tiers start at 10 units, so 12 units always get the tier price).
- **Northwind shipping:** $49.00 per order, free when the merchandise subtotal is $2,000 or more.
- **Acme shipping:** $12.50 per unit, free when the merchandise subtotal is $3,000 or more. For 12 units that is $150.00.
- **Lead time** is shown on each product page as business days to delivery, transit included. "Within 3 business days" means a lead time of 3 or less.
- **Specs** come from the product pages: the dual-display line must promise two 4K outputs, and host power delivery (with what ships in the box) must be 90 W or more.

No sales tax is charged on these contract orders.

## All options for 12 units

| Supplier | Model | Contract unit (1–9) | 10+ tier | 12 × tier | Shipping | Delivered total | Lead time | Dual 4K | Host power | Result |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|---|
| Northwind | Dell WD19S 130W | $209.00 | $195.00 | $2,340.00 | $0.00 | **$2,340.00** | 2 d | yes | 90 W | **Correct** |
| Acme | Dell WD19S 130W | $199.00 | $189.00 | $2,268.00 | $150.00 | $2,418.00 | 1 d | yes | 90 W | Over budget by $18 |
| Acme | Plugable UD-ULTC4K | $185.00 | $179.00 | $2,148.00 | $150.00 | $2,298.00 | 6 d | yes | 100 W | Too slow |
| Northwind | Plugable UD-ULTC4K | $199.00 | $192.00 | $2,304.00 | $0.00 | $2,304.00 | 4 d | yes | 100 W | Too slow |
| Northwind | CalDigit TS4 | $335.00 | $319.00 | $3,828.00 | $0.00 | $3,828.00 | 2 d | yes | 98 W | Over budget |
| Acme | CalDigit TS4 | $339.00 | $325.00 | $3,900.00 | $0.00 | $3,900.00 | 3 d | yes | 98 W | Over budget |
| Northwind | Lenovo ThinkPad Universal USB-C Dock (40AY) | $169.00 | $159.00 | $1,908.00 | $49.00 | $1,957.00 | 5 d | yes | 65 W | Underpowered, too slow |
| Acme | Lenovo ThinkPad Universal USB-C Dock (40AY) | $165.00 | $158.00 | $1,896.00 | $150.00 | $2,046.00 | 7 d | yes | 65 W | Underpowered, too slow, only 9 in stock |
| Northwind | Anker 563 (10-in-1) | $139.00 | $129.00 | $1,548.00 | $49.00 | $1,597.00 | 1 d | no (4K@30 + 2K) | 100 W | No dual 4K |
| Acme | Anker 563 (10-in-1) | $129.00 | $121.00 | $1,452.00 | $150.00 | $1,602.00 | 2 d | no (4K@30 + 2K) | 100 W | No dual 4K |

Arithmetic for the two Dell rows:

- Northwind: 12 × $195.00 = $2,340.00. $2,340.00 ≥ $2,000.00, so shipping is $0.00. Total $2,340.00 ≤ $2,400.00. Lead time 2 ≤ 3.
- Acme: 12 × $189.00 = $2,268.00. $2,268.00 < $3,000.00, so shipping is 12 × $12.50 = $150.00. Total $2,418.00 > $2,400.00.

## Why the obvious shortcuts fail

- **Lowest contract unit price overall** is the Anker 563 at Acme ($129.00), but it drives one 4K display at 30 Hz plus 2K, not dual 4K.
- **Lowest contract unit price among docks that meet the specs** is the Plugable UD-ULTC4K at Acme ($185.00, and $2,298.00 delivered, the cheapest qualifying total). Its lead time is 6 business days.
- **Ignoring volume tiers:** Northwind's Dell costs 12 × $209.00 = $2,508.00, which looks over budget and rules out the correct answer.
- **Ignoring shipping:** Acme's Dell looks cheaper than Northwind's ($2,268.00 vs $2,340.00), but delivered it costs $2,418.00, over budget.
- **Lenovo 40AY:** "up to 100 W" needs an optional 135 W adapter; as shipped it delivers 65 W. Its 5- and 7-day lead times rule it out regardless.

## Keeping this true

`catalog/catalog.json` is the single source for both stores. After changing any number there, run:

```bash
python scripts/reference_task.py
```

It recomputes the table above and fails unless exactly one option satisfies the task. Re-run `scripts/seed.sh` to push the catalog into both stores.
