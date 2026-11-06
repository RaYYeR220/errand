import InfoPage from "@/modules/info"
import { Metadata } from "next"

export const metadata: Metadata = { title: "Contact | Northwind Supply" }

export default function Page() {
  return <InfoPage page="contact" />
}
