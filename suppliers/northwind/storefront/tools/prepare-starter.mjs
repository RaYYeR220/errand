// Prepares the upstream storefront before the overlay build:
//  1. Replaces the starter's placeholder store name and copy with Northwind
//     Supply.
//  2. Removes generateStaticParams from pages, because every page renders per
//     request and the backend is not reachable during the image build.
// Every edit must match, so upstream changes fail the build loudly.
import fs from "node:fs"
import path from "node:path"

const root = process.argv[2] ?? "."

const fail = (message) => {
  console.error(`prepare-starter: ${message}`)
  process.exit(1)
}

const replacements = [
  ["src/modules/layout/templates/nav/index.tsx", "Medusa B2B Starter", "Northwind Supply"],
  ["src/app/[countryCode]/(checkout)/layout.tsx", "Medusa B2B Starter", "Northwind Supply"],
  ["src/modules/layout/templates/footer/index.tsx", "Medusa Store", "Northwind Supply"],
  ["src/modules/layout/components/side-menu/index.tsx", "Medusa Store", "Northwind Supply"],
  ["src/app/[countryCode]/(main)/account/@login/page.tsx", "Log in to your Medusa Store account.", "Sign in to your Northwind Supply business account."],
  ["src/app/[countryCode]/(main)/account/@dashboard/profile/page.tsx", "View and edit your Medusa Store profile.", "View and edit your Northwind Supply profile."],
  ["src/app/[countryCode]/(main)/categories/[...category]/page.tsx", "Medusa Store", "Northwind Supply"],
  ["src/app/[countryCode]/(main)/collections/[handle]/page.tsx", "Medusa Store", "Northwind Supply"],
  ["src/app/[countryCode]/(main)/products/[handle]/page.tsx", "Medusa Store", "Northwind Supply"],
  ["src/app/[countryCode]/(main)/page.tsx", "Medusa Next.js Starter Template", "Northwind Supply"],
  ["src/app/[countryCode]/(main)/page.tsx", "A performant frontend ecommerce starter template with Next.js 14 and Medusa.", "Docking stations and office hardware with contract pricing for business accounts."],
  // Product cards: brand from the product subtitle, real stock counts.
  ["src/modules/products/components/product-preview/index.tsx", '<Text className="text-neutral-600 text-xs">BRAND</Text>', '<Text className="text-neutral-600 text-xs">{product.subtitle}</Text>'],
  ["src/lib/data/products.ts", 'fields: "*variants.calculated_price",', 'fields: "*variants.calculated_price,+variants.inventory_quantity",'],
  ["src/modules/cart/components/item-full/index.tsx", '<span className="text-neutral-600 text-[0.6rem]">BRAND</span>', '<span className="text-neutral-600 text-[0.6rem]">{item.product?.subtitle}</span>'],
  // Order pages show the PO number, cost center and payment terms.
  ["src/lib/data/orders.ts", '"*payment_collections.payments,*items,', '"+metadata,*payment_collections.payments,*items,'],
  ["src/modules/order/components/payment-details/index.tsx", "})} paid at ${new Date(", "})} on invoice, issued ${new Date("],
  ["src/modules/checkout/components/review/index.tsx", "By Completing this order, I agree to Medusa&apos;s", "By placing this order, I agree to Northwind Supply&apos;s"],
]

const staticParamPages = [
  "src/app/[countryCode]/(main)/page.tsx",
  "src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  "src/app/[countryCode]/(main)/categories/[...category]/page.tsx",
  "src/app/[countryCode]/(main)/collections/[handle]/page.tsx",
]

const edit = (file, transform) => {
  const target = path.join(root, file)
  fs.writeFileSync(target, transform(fs.readFileSync(target, "utf8")))
}

for (const [file, from, to] of replacements) {
  edit(file, (source) => {
    if (!source.includes(from)) {
      fail(`"${from}" not found in ${file}`)
    }
    return source.split(from).join(to)
  })
}

const SIGNATURE = "export async function generateStaticParams()"

for (const file of staticParamPages) {
  edit(file, (source) => {
    const start = source.indexOf(SIGNATURE)
    if (start === -1) {
      fail(`generateStaticParams not found in ${file}`)
    }
    const open = source.indexOf("{", start + SIGNATURE.length)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++
      if (source[i] === "}" && --depth === 0) {
        return source.slice(0, start) + source.slice(i + 1)
      }
    }
    fail(`unbalanced braces in ${file}`)
  })
}

console.log(
  `prepare-starter: ${replacements.length} replacements, ${staticParamPages.length} pages made request-time only`
)
