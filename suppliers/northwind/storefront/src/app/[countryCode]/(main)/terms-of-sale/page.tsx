import InfoPage from "@/modules/info"
import { Metadata } from "next"

export const metadata: Metadata = { title: "Terms of Sale | Northwind Supply" }

export default function Page() {
  return <InfoPage page="terms-of-sale" />
}
