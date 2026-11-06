import { Heading } from "@medusajs/ui"
import Button from "@/modules/common/components/button"
import LocalizedClientLink from "@/modules/common/components/localized-client-link"

const Hero = () => {
  return (
    <div className="w-full border-b border-ui-border-base relative bg-neutral-100">
      <div className="flex flex-col justify-center items-center text-center small:py-32 py-16 px-6 gap-6">
        <span>
          <p className="text-neutral-600 text-xs uppercase tracking-wide">
            Northwind Supply for business
          </p>

          <Heading
            level="h1"
            className="small:text-6xl text-4xl leading-tight text-ui-fg-base font-normal mt-6 mb-4"
          >
            Docking stations for every desk
          </Heading>

          <p className="text-ui-fg-subtle font-normal text-lg max-w-2xl">
            Thunderbolt and USB-C docks from CalDigit, Dell, Lenovo, Anker and
            Plugable. Contract pricing, volume tiers and net-30 invoicing for
            business accounts.
          </p>
        </span>
        <LocalizedClientLink href="/store">
          <Button variant="secondary" className="rounded-2xl">
            Browse the catalog
          </Button>
        </LocalizedClientLink>
      </div>
    </div>
  )
}

export default Hero
