import { Heading, Text } from "@medusajs/ui"

export const INFO_PAGES = {
  "terms-of-sale": {
    title: "Terms of Sale",
    paragraphs: [
      "Orders from business accounts are invoiced on net-30 terms against the purchase order number given at checkout.",
      "Contract prices and volume tiers apply to the account's company price list in force on the order date. Lead times are business days to delivery and are confirmed on the order acknowledgement.",
      "Standard freight is free on orders at or above the threshold shown on each product page.",
    ],
  },
  "privacy-policy": {
    title: "Privacy Policy",
    paragraphs: [
      "Northwind Supply stores the account, address and order details needed to fulfil and invoice business orders. Session cookies are strictly necessary and are not used for advertising.",
    ],
  },
  contact: {
    title: "Contact",
    paragraphs: [
      "Northwind Supply, 4100 Distribution Pkwy, Columbus, OH 43217.",
      "Account managers: accounts@northwind-supply.example",
    ],
  },
} as const

export type InfoPageKey = keyof typeof INFO_PAGES

export default function InfoPage({ page }: { page: InfoPageKey }) {
  const { title, paragraphs } = INFO_PAGES[page]
  return (
    <div className="content-container py-16 max-w-3xl flex flex-col gap-4">
      <Heading level="h1" className="text-3xl">
        {title}
      </Heading>
      {paragraphs.map((paragraph) => (
        <Text key={paragraph} className="text-neutral-700">
          {paragraph}
        </Text>
      ))}
    </div>
  )
}
