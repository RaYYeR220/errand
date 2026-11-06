/**
 * Pricing-context attribute that carries cart line quantities. A volume tier
 * is stored as a price-list price with the rule
 * `{ "line_qty.<variant_id>": [{ operator: "gte", value: <min_qty> }] }`.
 */
export const LINE_QTY_ATTRIBUTE = "line_qty";

export const lineQtyRuleAttribute = (variantId: string) =>
  `${LINE_QTY_ATTRIBUTE}.${variantId}`;

type Line = { variant_id?: string | null; quantity?: unknown };

/** Sums quantities per variant into the pricing-context shape. */
export function lineQuantityContext(lines: Line[]) {
  const quantities: Record<string, number> = {};
  for (const line of lines) {
    if (!line.variant_id) {
      continue;
    }
    const quantity = Number(line.quantity ?? 0);
    if (Number.isFinite(quantity) && quantity > 0) {
      quantities[line.variant_id] = (quantities[line.variant_id] ?? 0) + quantity;
    }
  }
  return { [LINE_QTY_ATTRIBUTE]: quantities };
}
