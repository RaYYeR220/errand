import { getBaseURL } from "@/lib/util/env"
import { Toaster } from "@medusajs/ui"
import { GeistSans } from "geist/font/sans"
import { Metadata } from "next"
import "@/styles/globals.css"

// Prices depend on who is signed in, so every page renders per request.
export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(getBaseURL()),
    title: "Northwind Supply",
    description:
      "Northwind Supply: office hardware for business accounts, with contract pricing and invoice terms.",
  }
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light" className={GeistSans.variable}>
      <body>
        <main className="relative">{props.children}</main>
        <Toaster className="z-[99999]" position="bottom-left" />
      </body>
    </html>
  )
}
