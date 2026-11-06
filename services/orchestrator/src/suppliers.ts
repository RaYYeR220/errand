import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface SupplierDef {
  id: string;
  name: string;
  platform: string;
  base_url: string;
  login_url: string;
  account: { username: string; password_env: string };
  order_request: { method: string; path_regex: string }[];
  js_readable_cookies?: string[];
  asset_hosts?: string[];
  /** Non-GET requests during checkout that are known not to place an order (regexes on the normalized target). */
  safe_requests?: string[];
}

export interface Supplier extends SupplierDef {
  host: string;
  password: string | undefined;
}

function expand(s: string, base: string, variant?: string) {
  const domain = variant ? `${variant}-` : "";
  return s.replace(/\{BASE_DOMAIN\}/g, base).replace(/^(https?:\/\/)([a-z0-9-]+)\./i, (_m, scheme, sub) => `${scheme}${domain}${sub}.`);
}

let cache: SupplierDef[] | undefined;

export function supplierDefs(): SupplierDef[] {
  if (cache) return cache;
  const file = path.resolve(config.suppliers.file);
  if (!existsSync(file)) return [];
  cache = (JSON.parse(readFileSync(file, "utf8")).suppliers ?? []) as SupplierDef[];
  return cache;
}

/**
 * Resolve a supplier for a run. `variant` selects a test-page host in front of the same store
 * (e.g. `tc03-northwind.<base>`), used by the containment test cases.
 */
export function resolveSupplier(id: string, variant?: string): Supplier {
  const def = supplierDefs().find((s) => s.id === id);
  if (!def) throw new Error(`unknown supplier ${id}`);
  const base_url = expand(def.base_url, config.suppliers.baseDomain, variant);
  const login_url = expand(def.login_url, config.suppliers.baseDomain, variant);
  return {
    ...def,
    base_url,
    login_url,
    host: new URL(base_url).host,
    password: process.env[def.account.password_env],
  };
}
