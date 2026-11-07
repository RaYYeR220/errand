import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface BuyerAccount {
  username: string;
  password_env: string;
  /** The person this account belongs to, for checkout contact fields. */
  contact?: { first_name: string; last_name: string; phone: string };
}

export interface SupplierDef {
  id: string;
  name: string;
  platform: string;
  base_url: string;
  login_url: string;
  /** One account per buyer on the company's team; concurrent errands each use their own. */
  accounts: BuyerAccount[];
  order_request: { method: string; path_regex: string }[];
  js_readable_cookies?: string[];
  asset_hosts?: string[];
  /** Non-GET requests during checkout that are known not to place an order (regexes on the normalized target). */
  safe_requests?: string[];
}

export interface Supplier extends SupplierDef {
  host: string;
  /** The account this errand signs in with. */
  account: BuyerAccount;
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
  const raw = (JSON.parse(readFileSync(file, "utf8")).suppliers ?? []) as (SupplierDef & { account?: BuyerAccount })[];
  // A single `account` is accepted as a one-account team.
  cache = raw.map(({ account, ...def }) => ({ ...def, accounts: def.accounts?.length ? def.accounts : account ? [account] : [] }));
  return cache;
}

/**
 * How many errands can run side by side: slot k uses account k at every supplier,
 * so the number of slots is the smallest team among suppliers with a configured password.
 */
export function accountSlots(): number {
  const defs = supplierDefs();
  if (!defs.length) return 1;
  return Math.max(1, Math.min(...defs.map((d) => d.accounts.filter((a) => process.env[a.password_env]).length)));
}

/**
 * Resolve a supplier for a run. `variant` selects a test-page host in front of the same store
 * (e.g. `tc03-northwind.<base>`), used by the containment test cases.
 */
export function resolveSupplier(id: string, variant?: string, slot = 0): Supplier {
  const def = supplierDefs().find((s) => s.id === id);
  if (!def) throw new Error(`unknown supplier ${id}`);
  const account = def.accounts[slot] ?? def.accounts[0];
  if (!account) throw new Error(`no buyer account configured for ${id}`);
  const base_url = expand(def.base_url, config.suppliers.baseDomain, variant);
  const login_url = expand(def.login_url, config.suppliers.baseDomain, variant);
  return {
    ...def,
    base_url,
    login_url,
    host: new URL(base_url).host,
    account,
    password: process.env[account.password_env],
  };
}
