#!/usr/bin/env python3
"""Evaluates the reference procurement task against catalog/catalog.json.

Task: 12 docks supporting dual 4K displays and >= 90 W power delivery,
budget $2,400 (delivered), must arrive within 3 business days.

Prints the landed cost of every supplier/model and exits non-zero unless
exactly one option satisfies every constraint. EXPECTED.md documents the
same arithmetic.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[1] / "catalog" / "catalog.json"

QUANTITY = 12
BUDGET = 2400.00
MAX_LEAD_TIME_DAYS = 3
MIN_POWER_W = 90


@dataclass
class Option:
    supplier: str
    model: str
    unit_price: float
    subtotal: float
    shipping: float
    total: float
    lead_time_days: int
    stock: int
    dual_4k: bool
    power_w: int

    @property
    def failures(self) -> list[str]:
        reasons = []
        if not self.dual_4k:
            reasons.append("no dual 4K")
        if self.power_w < MIN_POWER_W:
            reasons.append(f"{self.power_w} W < {MIN_POWER_W} W")
        if self.stock < QUANTITY:
            reasons.append(f"only {self.stock} in stock")
        if self.lead_time_days > MAX_LEAD_TIME_DAYS:
            reasons.append(f"{self.lead_time_days}-day lead time")
        if self.total > BUDGET:
            reasons.append(f"${self.total:,.2f} > budget")
        return reasons


def supports_dual_4k(spec: str) -> bool:
    """True when the dual-display line promises two 4K (or better) outputs."""
    return re.match(r"^\s*[23] × (4K|5K|6K|8K)", spec) is not None


def unit_price(offer: dict, quantity: int) -> float:
    price = offer["contract_price"]
    for tier in offer["tiers"]:
        if quantity >= tier["min_qty"]:
            price = min(price, tier["price"])
    return price


def shipping_cost(shipping: dict, quantity: int, subtotal: float) -> float:
    if subtotal >= shipping["free_threshold"]:
        return 0.0
    if shipping["type"] == "per_unit":
        return round(shipping["rate"] * quantity, 2)
    return shipping["rate"]


def evaluate(catalog: dict) -> list[Option]:
    options = []
    for supplier_id, supplier in catalog["suppliers"].items():
        for product in catalog["products"]:
            offer = supplier["offers"].get(product["key"])
            if not offer:
                continue
            price = unit_price(offer, QUANTITY)
            subtotal = round(price * QUANTITY, 2)
            shipping = shipping_cost(supplier["shipping"], QUANTITY, subtotal)
            options.append(
                Option(
                    supplier=supplier_id,
                    model=product["title"],
                    unit_price=price,
                    subtotal=subtotal,
                    shipping=shipping,
                    total=round(subtotal + shipping, 2),
                    lead_time_days=offer["lead_time_days"],
                    stock=offer["stock"],
                    dual_4k=supports_dual_4k(product["specs"]["dual_display_max"]),
                    power_w=int(product["specs"]["power_delivery_w"]),
                )
            )
    return options


def main() -> int:
    options = evaluate(json.loads(CATALOG.read_text(encoding="utf-8")))
    print(f"{'supplier':<10} {'model':<46} {'unit':>8} {'subtotal':>10} {'ship':>8} {'total':>10}  result")
    for o in sorted(options, key=lambda o: o.total):
        verdict = "OK" if not o.failures else "; ".join(o.failures)
        print(
            f"{o.supplier:<10} {o.model:<46} {o.unit_price:>8.2f} {o.subtotal:>10.2f} "
            f"{o.shipping:>8.2f} {o.total:>10.2f}  {verdict}"
        )
    feasible = [o for o in options if not o.failures]
    if len(feasible) != 1:
        print(f"expected exactly one feasible option, found {len(feasible)}", file=sys.stderr)
        return 1
    winner = feasible[0]
    print(f"\nanswer: {winner.supplier} / {winner.model} at ${winner.total:,.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
