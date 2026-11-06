import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaContainer } from "@medusajs/framework/types";
import {
  addToCartWorkflow,
  refreshCartItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows";
import { lineQuantityContext } from "../../utils/volume-pricing";

/**
 * Volume tiers are price-list prices carrying a `line_qty.<variant_id> gte N`
 * rule. Medusa prices every variant of a cart against one pricing context, so
 * each hook below hands the pricing module the quantity of every line, keyed
 * by variant. A tier price then only matches the line it belongs to.
 */

type Line = { id?: string; variant_id?: string | null; quantity?: unknown };

async function cartLines(
  container: MedusaContainer,
  cartId: string
): Promise<Line[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const {
    data: [cart],
  } = await query.graph({
    entity: "cart",
    fields: ["items.id", "items.variant_id", "items.quantity"],
    filters: { id: cartId },
  });
  return (cart?.items ?? []) as Line[];
}

addToCartWorkflow.hooks.setPricingContext(
  async ({ cart, items }, { container }) => {
    const existing = await cartLines(container, cart.id);
    return new StepResponse(
      lineQuantityContext([...existing, ...((items ?? []) as Line[])])
    );
  }
);

// The update workflow exposes the requested quantity to its validate hook only,
// so it is carried over to the pricing hook of the same transaction.
const requestedQuantities = new Map<string, { itemId: string; quantity: number }>();

updateLineItemInCartWorkflow.hooks.validate(({ input }, { context }) => {
  const transactionId = context?.transactionId;
  if (transactionId && input.update?.quantity !== undefined) {
    requestedQuantities.set(transactionId, {
      itemId: input.item_id,
      quantity: Number(input.update.quantity),
    });
  }
  return new StepResponse(undefined);
});

updateLineItemInCartWorkflow.hooks.setPricingContext(
  async ({ cart }, { container, context }) => {
    const transactionId = context?.transactionId;
    const requested = transactionId
      ? requestedQuantities.get(transactionId)
      : undefined;
    if (transactionId) {
      requestedQuantities.delete(transactionId);
    }

    const lines = (await cartLines(container, cart.id)).map((line) =>
      requested && line.id === requested.itemId
        ? { ...line, quantity: requested.quantity }
        : line
    );
    return new StepResponse(lineQuantityContext(lines));
  }
);

refreshCartItemsWorkflow.hooks.setPricingContext(
  async ({ cart_id }, { container }) => {
    return new StepResponse(
      lineQuantityContext(await cartLines(container, cart_id))
    );
  }
);
