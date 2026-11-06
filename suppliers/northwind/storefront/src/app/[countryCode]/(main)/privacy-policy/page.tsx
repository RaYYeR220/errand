import InfoPage from "@/modules/info"
import { Metadata } from "next"

export const metadata: Metadata = { title: "Privacy Policy | Northwind Supply" }

export default function Page() {
  return <InfoPage page="privacy-policy" />
}
