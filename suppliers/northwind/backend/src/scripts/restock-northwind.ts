/**
 * Restock: tops the available quantity of every catalog variant back up to the
 * catalog number at the Northwind warehouse. Touches inventory levels only (no
 * products, prices or accounts), so it is safe to run while buyers are browsing.
 * Reservations of open orders stay in place: stocked = catalog stock + reserved.
 *
 *   docker compose exec -T northwind-backend /app/docker-entrypoint.sh restock
 */
import fs from "node:fs";
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

const STOCK_LOCATION = "Northwind DC - Columbus, OH";

type Catalog = {
  products: { key: string }[];
  suppliers: { northwind: { offers: Record<string, { sku: string; stock: number }> } };
};

export default async function restockNorthwind({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);
  const inventoryModule = container.resolve(Modules.INVENTORY);

  const catalog: Catalog = JSON.parse(fs.readFileSync(process.env.CATALOG_PATH || "/catalog/catalog.json", "utf8"));
  const offers = catalog.suppliers.northwind.offers;
  const [location] = await stockLocationModule.listStockLocations({ name: STOCK_LOCATION });
  if (!location) throw new Error(`stock location "${STOCK_LOCATION}" not found; run the seed first`);

  const skus = catalog.products.map((p) => offers[p.key]?.sku).filter((s): s is string => Boolean(s));
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "sku", "inventory_items.inventory_item_id"],
    filters: { sku: skus },
  });

  const updates: { id: string; inventory_item_id: string; location_id: string; stocked_quantity: number }[] = [];
  const changed: string[] = [];
  for (const product of catalog.products) {
    const offer = offers[product.key];
    if (!offer) continue;
    const variant = variants.find((v: any) => v.sku === offer.sku);
    const inventoryItemId = variant?.inventory_items?.[0]?.inventory_item_id as string | undefined;
    if (!inventoryItemId) continue;
    const [level] = await inventoryModule.listInventoryLevels({ inventory_item_id: inventoryItemId, location_id: location.id });
    if (!level) continue;
    const reserved = Number(level.reserved_quantity ?? 0);
    const available = Number(level.stocked_quantity ?? 0) - reserved;
    if (available >= offer.stock) continue;
    updates.push({ id: level.id, inventory_item_id: inventoryItemId, location_id: location.id, stocked_quantity: offer.stock + reserved });
    changed.push(`${offer.sku} ${available}→${offer.stock}`);
  }
  if (updates.length) await updateInventoryLevelsWorkflow(container).run({ input: { updates } });
  logger.info(changed.length ? `Northwind restocked: ${changed.join(", ")}` : "Northwind restock: nothing to do");
}
