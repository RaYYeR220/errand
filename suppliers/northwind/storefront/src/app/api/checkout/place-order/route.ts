import { sdk } from "@/lib/config"
import {
  getAuthHeaders,
  getCacheTag,
  getCartId,
  removeCartId,
} from "@/lib/data/cookies"
import { getBaseURL } from "@/lib/util/env"
import { revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/checkout/place-order
 *
 * Completes the current cart into an order. Every other checkout step (address,
 * shipping, contact details, payment session) is a server action on the
 * checkout page; this endpoint is the one request that commits a purchase.
 *
 * Responses:
 *   200 { order_id, display_id, redirect }
 *   400 no cart, 403 cross-origin, 409 cart not completable, 502 backend error
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (origin && origin !== new URL(getBaseURL()).origin) {
    return NextResponse.json({ message: "Cross-origin request" }, { status: 403 })
  }

  const cartId = await getCartId()
  if (!cartId) {
    return NextResponse.json({ message: "No cart to check out" }, { status: 400 })
  }

  let result
  try {
    result = await sdk.store.cart.complete(cartId, {}, await getAuthHeaders())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order placement failed"
    return NextResponse.json({ message }, { status: 502 })
  }

  if (result.type === "cart") {
    return NextResponse.json(
      { message: result.error?.message ?? "The cart could not be completed" },
      { status: 409 }
    )
  }

  for (const tag of ["carts", "orders", "approvals"]) {
    const cacheTag = await getCacheTag(tag)
    if (cacheTag) {
      revalidateTag(cacheTag)
    }
  }
  await removeCartId()

  const { order } = result
  const countryCode =
    order.shipping_address?.country_code?.toLowerCase() ||
    process.env.DEFAULT_REGION ||
    "us"

  return NextResponse.json({
    order_id: order.id,
    display_id: order.display_id,
    redirect: `/${countryCode}/order/confirmed/${order.id}`,
  })
}
