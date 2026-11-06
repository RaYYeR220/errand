import { getProductPrice } from "@/lib/util/get-product-price"
import { convertToLocale } from "@/lib/util/money"
import {
  CheckCircleSolid,
  ExclamationCircleSolid,
  InformationCircleSolid,
} from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Table, Text } from "@medusajs/ui"

type Tier = { min_qty: number; price: number }

const SPECS: [string, string][] = [
  ["spec_host_connection", "Host connection"],
  ["spec_external_displays", "External displays (max)"],
  ["spec_dual_display_max", "Dual-display max resolution"],
  ["spec_single_display_max", "Single-display max resolution"],
  ["spec_power_delivery_w", "Host power delivery"],
  ["spec_power_delivery_note", "Power delivery details"],
  ["spec_ports", "Ports"],
]

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`

/** Stock, lead time, shipping terms, volume tiers and key specifications. */
const ProductFacts = ({ product }: { product: HttpTypes.StoreProduct }) => {
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const inventoryQuantity =
    product.variants?.reduce(
      (acc, variant) => acc + (variant.inventory_quantity ?? 0),
      0
    ) || 0
  const leadTime = Number(metadata.lead_time_business_days)
  const tiers = (
    Array.isArray(metadata.contract_tiers) ? metadata.contract_tiers : []
  ) as Tier[]

  const { cheapestPrice } = getProductPrice({ product })
  const isContract = cheapestPrice?.price_type === "sale"
  const currency = cheapestPrice?.currency_code ?? "usd"

  return (
    <div className="flex flex-col gap-y-4 w-full" data-testid="product-facts">
      <div className="flex flex-col gap-y-2">
        <span
          className="flex items-center gap-x-2 text-neutral-700 text-sm"
          data-testid="product-stock"
          data-value={inventoryQuantity}
        >
          {inventoryQuantity > 10 ? (
            <CheckCircleSolid className="text-green-500" />
          ) : (
            <ExclamationCircleSolid className="text-orange-500" />
          )}
          {inventoryQuantity > 10 ? "In stock" : "Limited stock"}:{" "}
          {plural(inventoryQuantity, "unit")}
        </span>
        {Number.isFinite(leadTime) && leadTime > 0 && (
          <span
            className="flex items-center gap-x-2 text-neutral-700 text-sm"
            data-testid="product-lead-time"
            data-value={leadTime}
          >
            <InformationCircleSolid />
            Lead time: {plural(leadTime, "business day")} to delivery
          </span>
        )}
        {typeof metadata.shipping === "string" && (
          <span
            className="flex items-center gap-x-2 text-neutral-700 text-sm"
            data-testid="product-shipping"
          >
            <InformationCircleSolid />
            {metadata.shipping}
          </span>
        )}
        {typeof metadata.warehouse === "string" && (
          <span className="flex items-center gap-x-2 text-neutral-600 text-sm">
            <InformationCircleSolid />
            Ships from {metadata.warehouse}
          </span>
        )}
      </div>

      {isContract && tiers.length > 0 && (
        <div className="flex flex-col gap-y-2" data-testid="volume-tiers">
          <Text className="text-sm font-medium text-neutral-950">
            Contract volume pricing
          </Text>
          <Table className="rounded-lg shadow-borders-base overflow-hidden border-none">
            <Table.Body>
              <Table.Row>
                <Table.Cell className="px-4 border-r">
                  1–{tiers[0].min_qty - 1} units
                </Table.Cell>
                <Table.Cell
                  className="px-4"
                  data-testid="tier-price"
                  data-min-qty={1}
                  data-value={cheapestPrice?.calculated_price_number}
                >
                  {cheapestPrice?.calculated_price} / unit
                </Table.Cell>
              </Table.Row>
              {tiers.map((tier) => (
                <Table.Row key={tier.min_qty}>
                  <Table.Cell className="px-4 border-r">
                    {tier.min_qty}+ units
                  </Table.Cell>
                  <Table.Cell
                    className="px-4"
                    data-testid="tier-price"
                    data-min-qty={tier.min_qty}
                    data-value={tier.price}
                  >
                    {convertToLocale({
                      amount: tier.price,
                      currency_code: currency,
                    })}{" "}
                    / unit
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Text className="text-xs text-neutral-500">
            A tier price applies to a cart line once its quantity reaches the
            tier.
          </Text>
        </div>
      )}

      {!isContract && (
        <Text
          className="text-sm text-neutral-600"
          data-testid="contract-pricing-hint"
        >
          Sign in with your business account to see contract and volume
          pricing.
        </Text>
      )}

      <div className="flex flex-col gap-y-2" data-testid="product-specs">
        <Text className="text-sm font-medium text-neutral-950">
          Key specifications
        </Text>
        <Table className="rounded-lg shadow-borders-base overflow-hidden border-none">
          <Table.Body>
            {metadata.mpn ? (
              <Table.Row>
                <Table.Cell className="px-4 border-r font-medium">
                  Manufacturer part
                </Table.Cell>
                <Table.Cell className="px-4">{String(metadata.mpn)}</Table.Cell>
              </Table.Row>
            ) : null}
            {SPECS.filter(([key]) => metadata[key] !== undefined).map(
              ([key, label]) => (
                <Table.Row key={key}>
                  <Table.Cell className="px-4 border-r font-medium align-top">
                    {label}
                  </Table.Cell>
                  <Table.Cell
                    className="px-4 !whitespace-normal"
                    data-spec={key.replace("spec_", "")}
                  >
                    {key === "spec_power_delivery_w"
                      ? `${metadata[key]} W`
                      : String(metadata[key])}
                  </Table.Cell>
                </Table.Row>
              )
            )}
          </Table.Body>
        </Table>
      </div>
    </div>
  )
}

export default ProductFacts
