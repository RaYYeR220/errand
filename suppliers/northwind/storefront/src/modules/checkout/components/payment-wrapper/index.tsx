"use client"

import { B2BCart } from "@/types"
import React, { createContext } from "react"

type WrapperProps = {
  cart: B2BCart
  children: React.ReactNode
}

export const StripeContext = createContext(false)

/**
 * Northwind takes orders on account (invoice, net 30) only, so checkout loads
 * no card or wallet SDK and contacts no third-party payment hosts.
 */
const Wrapper: React.FC<WrapperProps> = ({ children }) => {
  return <div>{children}</div>
}

export default Wrapper
