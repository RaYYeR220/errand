import { getProductPrice } from "@/lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import { clx, Text } from "@medusajs/ui"

/**
 * Unit price for the current visitor. Signed-in buyers get the price from
 * their company's contract price list; guests see the list price.
 */
export default function ProductPrice({
  product,
}: {
  product: HttpTypes.StoreProduct
}) {
  const { cheapestPrice } = getProductPrice({ product })

  if (!cheapestPrice) {
    return <div className="block w-32 h-9 bg-gray-100 animate-pulse" />
  }

  const isContract = cheapestPrice.price_type === "sale"

  return (
    <div className="flex flex-col text-neutral-950" data-testid="price-block">
      <Text className="text-neutral-600 text-xs uppercase tracking-wide">
        {isContract ? "Your contract price" : "List price"}
      </Text>
      <span className={clx({ "text-ui-fg-interactive": isContract })}>
        <Text
          className="font-medium text-xl"
          data-testid="product-price"
          data-price-type={isContract ? "contract" : "list"}
          data-value={cheapestPrice.calculated_price_number}
        >
          {cheapestPrice.calculated_price}
          <span className="text-neutral-600 text-sm font-normal"> / unit</span>
        </Text>
      </span>
      {isContract && (
        <Text
          className="text-neutral-500 text-sm"
          data-testid="original-product-price"
          data-value={cheapestPrice.original_price_number}
        >
          List price{" "}
          <span className="line-through">{cheapestPrice.original_price}</span>
        </Text>
      )}
      <Text className="text-neutral-600 text-[0.6rem]">Excl. tax</Text>
    </div>
  )
}
