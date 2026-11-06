import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@medusajs/ui"

type OrderDetailsProps = {
  order: HttpTypes.StoreOrder
}

const OrderDetails = ({ order }: OrderDetailsProps) => {
  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  const rows: [string, string, string][] = [
    ["Order number", `#${order.display_id}`, "order-number"],
    [
      "Order date",
      new Date(order.created_at).toISOString().slice(0, 10),
      "order-date",
    ],
  ]
  if (metadata.po_number) {
    rows.push(["PO number", String(metadata.po_number), "order-po-number"])
  }
  if (metadata.cost_center) {
    rows.push(["Cost center", String(metadata.cost_center), "order-cost-center"])
  }
  if (metadata.payment_terms) {
    rows.push(["Payment terms", String(metadata.payment_terms), "order-payment-terms"])
  }

  return (
    <>
      <Heading level="h3" className="mb-2">
        Details
      </Heading>

      <div className="text-sm text-ui-fg-subtle overflow-auto">
        {rows.map(([label, value, testId]) => (
          <div className="flex justify-between" key={label}>
            <Text>{label}</Text>
            <Text data-testid={testId}>{value}</Text>
          </div>
        ))}

        <Text className="mt-2">
          We have sent the order confirmation details to{" "}
          <span className="font-semibold">{order.email}</span>.
        </Text>
      </div>
    </>
  )
}

export default OrderDetails
