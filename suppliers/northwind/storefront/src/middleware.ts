import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
const PUBLISHABLE_API_KEY = process.env.MEDUSA_PUBLISHABLE_KEY || ""
const DEFAULT_REGION = process.env.DEFAULT_REGION || "us"
const SECURE_COOKIES = (process.env.BASE_URL || "").startsWith("https://")

const regionMapCache = {
  regionMap: new Map<string, HttpTypes.StoreRegion>(),
  regionMapUpdated: Date.now(),
}

async function getRegionMap() {
  const { regionMap, regionMapUpdated } = regionMapCache

  if (
    !regionMap.keys().next().value ||
    regionMapUpdated < Date.now() - 3600 * 1000
  ) {
    const response = await fetch(`${BACKEND_URL}/store/regions`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_API_KEY },
      cache: "no-store",
    })
    const json = await response.json()

    if (!response.ok) {
      throw new Error(json.message)
    }

    const regions: HttpTypes.StoreRegion[] = json.regions ?? []
    if (!regions.length) {
      throw new Error("No regions found. Run the Northwind seed first.")
    }

    regionMap.clear()
    regions.forEach((region) => {
      region.countries?.forEach((c) => {
        regionMap.set(c.iso_2 ?? "", region)
      })
    })
    regionMapCache.regionMapUpdated = Date.now()
  }

  return regionMapCache.regionMap
}

function getCountryCode(
  request: NextRequest,
  regionMap: Map<string, HttpTypes.StoreRegion>
) {
  const urlCountryCode = request.nextUrl.pathname.split("/")[1]?.toLowerCase()

  if (urlCountryCode && regionMap.has(urlCountryCode)) {
    return urlCountryCode
  }
  if (regionMap.has(DEFAULT_REGION)) {
    return DEFAULT_REGION
  }
  return regionMap.keys().next().value
}

const cookieOptions = {
  maxAge: 60 * 60 * 24,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: SECURE_COOKIES,
  path: "/",
}

/**
 * Region routing and the per-browser cache id. Redirects requests without a
 * country code to the default region.
 */
export async function middleware(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const cartId = searchParams.get("cart_id")
  const checkoutStep = searchParams.get("step")
  const cacheIdCookie = request.cookies.get("_medusa_cache_id")
  const cartIdCookie = request.cookies.get("_medusa_cart_id")

  const regionMap = await getRegionMap()
  const countryCode = getCountryCode(request, regionMap)

  const urlHasCountryCode =
    countryCode && request.nextUrl.pathname.split("/")[1] === countryCode

  if (urlHasCountryCode && (!cartId || cartIdCookie) && cacheIdCookie) {
    return NextResponse.next()
  }

  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const redirectPath =
    request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
  const queryString = request.nextUrl.search ? request.nextUrl.search : ""

  const origin = originOf(request)
  const currentUrl = `${origin}${request.nextUrl.pathname}${queryString}`
  let redirectUrl = currentUrl
  if (!urlHasCountryCode && countryCode) {
    redirectUrl = `${origin}/${countryCode}${redirectPath}${queryString}`
  }

  if (cartId && !checkoutStep) {
    redirectUrl = `${redirectUrl}&step=address`
  }

  // Same URL and only the cache id missing: continue and set it on the way out.
  if (redirectUrl === currentUrl) {
    const response = NextResponse.next()
    if (!cacheIdCookie) {
      response.cookies.set("_medusa_cache_id", crypto.randomUUID(), cookieOptions)
    }
    return response
  }

  const response = NextResponse.redirect(redirectUrl, 307)
  if (!cacheIdCookie) {
    response.cookies.set("_medusa_cache_id", crypto.randomUUID(), cookieOptions)
  }
  if (cartId && !checkoutStep) {
    response.cookies.set("_medusa_cart_id", cartId, cookieOptions)
  }
  return response
}

/** Public origin as seen by the browser (the app runs behind a reverse proxy). */
function originOf(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "")
  return host ? `${proto}://${host}` : request.nextUrl.origin
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
