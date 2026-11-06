import fs from "node:fs";
import {
  createApiKeysWorkflow,
  createCustomerAccountWorkflow,
  createCustomerAddressesWorkflow,
  createCustomerGroupsWorkflow,
  createInventoryLevelsWorkflow,
  createPriceListsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  createUserAccountWorkflow,
  deletePriceListsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateInventoryLevelsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
  updateShippingOptionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import { COMPANY_MODULE } from "../modules/company";
import { createCompaniesWorkflow } from "../workflows/company/workflows/create-companies";
import { addCompanyToCustomerGroupWorkflow } from "../workflows/company/workflows/add-company-to-customer-group";
import { createEmployeesWorkflow } from "../workflows/employee/workflows/create-employees";
import { lineQtyRuleAttribute } from "../utils/volume-pricing";

// Northwind Supply seed. Safe to run repeatedly: every record is looked up by a
// stable key (name, handle, email) and updated in place, stock is reset to the
// catalog numbers and the contract price list is rebuilt.

type Tier = { min_qty: number; price: number };
type Offer = {
  sku: string;
  list_price: number;
  contract_price: number;
  tiers: Tier[];
  stock: number;
  lead_time_days: number;
};
type CatalogProduct = {
  key: string;
  title: string;
  brand: string;
  mpn: string;
  summary: string;
  specs: Record<string, string | number>;
};
type Catalog = {
  currency: string;
  buyer: {
    company: string;
    company_email: string;
    contact: { first_name: string; last_name: string; phone: string };
    address: {
      company: string;
      address_1: string;
      address_2: string;
      city: string;
      province: string;
      postal_code: string;
      country_code: string;
    };
  };
  products: CatalogProduct[];
  suppliers: {
    northwind: {
      name: string;
      warehouse: string;
      shipping: {
        label: string;
        description: string;
        rate: number;
        free_threshold: number;
      };
      offers: Record<string, Offer>;
    };
  };
};

const SALES_CHANNEL = "Northwind Web";
const REGION = "United States";
const STOCK_LOCATION = "Northwind DC - Columbus, OH";
const FULFILLMENT_SET = "Northwind DC shipping";
const API_KEY_TITLE = "Northwind storefront";
const CATEGORY_HANDLE = "docking-stations";
const PRICE_LIST_TITLE = "Lumen Labs contract pricing";
const MANUAL_PAYMENT = "pp_system_default";
const MANUAL_FULFILLMENT = "manual_manual";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
};

const usd = (amount: number) => Math.round(amount * 100) / 100;

const SPEC_LABELS: Record<string, string> = {
  host_connection: "Host connection",
  external_displays: "External displays (max)",
  dual_display_max: "Dual-display max resolution",
  single_display_max: "Single-display max resolution",
  power_delivery_w: "Host power delivery (W)",
  power_delivery_note: "Power delivery details",
  ports: "Ports",
};

function describe(product: CatalogProduct, offer: Offer, shippingLine: string) {
  const specs = Object.entries(product.specs)
    .map(([key, value]) => `- ${SPEC_LABELS[key] ?? key}: ${value}`)
    .join("\n");
  return [
    product.summary,
    "",
    "Specifications",
    specs,
    "",
    `Lead time: ${offer.lead_time_days} business day${offer.lead_time_days === 1 ? "" : "s"} to delivery.`,
    shippingLine,
  ].join("\n");
}

export default async function seedNorthwind({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const catalog: Catalog = JSON.parse(
    fs.readFileSync(process.env.CATALOG_PATH || "/catalog/catalog.json", "utf8")
  );
  const supplier = catalog.suppliers.northwind;
  const currency = catalog.currency;

  const storeModule = container.resolve(Modules.STORE);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  const regionModule = container.resolve(Modules.REGION);
  const taxModule = container.resolve(Modules.TAX);
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const apiKeyModule = container.resolve(Modules.API_KEY);
  const productModule = container.resolve(Modules.PRODUCT);
  const inventoryModule = container.resolve(Modules.INVENTORY);
  const customerModule = container.resolve(Modules.CUSTOMER);
  const pricingModule = container.resolve(Modules.PRICING);
  const authModule = container.resolve(Modules.AUTH);
  const userModule = container.resolve(Modules.USER);
  const companyModule: any = container.resolve(COMPANY_MODULE);

  // Sales channel and store ---------------------------------------------------
  let [salesChannel] = await salesChannelModule.listSalesChannels({
    name: SALES_CHANNEL,
  });
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: SALES_CHANNEL }] },
    });
    salesChannel = result[0];
  }

  const [store] = await storeModule.listStores();
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: supplier.name,
        supported_currencies: [{ currency_code: currency, is_default: true }],
        default_sales_channel_id: salesChannel.id,
      },
    },
  });

  // Region, tax ---------------------------------------------------------------
  let [region] = await regionModule.listRegions({ name: REGION });
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION,
            currency_code: currency,
            countries: ["us"],
            payment_providers: [MANUAL_PAYMENT],
          },
        ],
      },
    });
    region = result[0];
  }

  const taxRegions = await taxModule.listTaxRegions({ country_code: "us" });
  if (!taxRegions.length) {
    // Contract orders are invoiced tax-exempt; no default rate is configured.
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "us", provider_id: "tp_system" }],
    });
  }

  // Stock location and fulfillment -------------------------------------------
  let [stockLocation] = await stockLocationModule.listStockLocations({
    name: STOCK_LOCATION,
  });
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION,
            address: {
              address_1: "4100 Distribution Pkwy",
              city: "Columbus",
              province: "OH",
              postal_code: "43217",
              country_code: "us",
            },
          },
        ],
      },
    });
    stockLocation = result[0];

    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: MANUAL_FULFILLMENT },
    });
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [salesChannel.id] },
    });
  }

  let [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  });
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    });
    shippingProfile = result[0];
  }

  let [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
    { name: FULFILLMENT_SET },
    { relations: ["service_zones"] }
  );
  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
      name: FULFILLMENT_SET,
      type: "shipping",
      service_zones: [
        {
          name: "United States",
          geo_zones: [{ country_code: "us", type: "country" }],
        },
      ],
    });
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    });
    [fulfillmentSet] = await fulfillmentModule.listFulfillmentSets(
      { id: fulfillmentSet.id },
      { relations: ["service_zones"] }
    );
  }

  const shippingPrices = [
    { currency_code: currency, amount: supplier.shipping.rate },
    {
      currency_code: currency,
      amount: 0,
      rules: [
        {
          attribute: "item_total",
          operator: "gte" as const,
          value: supplier.shipping.free_threshold,
        },
      ],
    },
  ];
  const [shippingOption] = await fulfillmentModule.listShippingOptions({
    name: supplier.shipping.label,
  });
  if (!shippingOption) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: supplier.shipping.label,
          price_type: "flat",
          provider_id: MANUAL_FULFILLMENT,
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: supplier.shipping.label,
            description: supplier.shipping.description,
            code: "standard-freight",
          },
          prices: shippingPrices as any,
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    });
  } else {
    await updateShippingOptionsWorkflow(container).run({
      input: [{ id: shippingOption.id, prices: shippingPrices as any }],
    });
  }

  // Publishable key -------------------------------------------------------------
  // The storefront ships with NORTHWIND_PUBLISHABLE_KEY from .env, so the key
  // token is set to that value instead of the generated one.
  const publishableToken = env("NORTHWIND_PUBLISHABLE_KEY");
  let [apiKey] = await apiKeyModule.listApiKeys({
    title: API_KEY_TITLE,
    type: "publishable",
  });
  if (!apiKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: API_KEY_TITLE, type: "publishable", created_by: "" }],
      },
    });
    apiKey = result[0];
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: apiKey.id, add: [salesChannel.id] },
    });
  }
  await pg("api_key")
    .where({ id: apiKey.id })
    .update({
      token: publishableToken,
      redacted: `${publishableToken.slice(0, 6)}***${publishableToken.slice(-3)}`,
    });

  // Category ------------------------------------------------------------------
  let [category] = await productModule.listProductCategories({
    handle: CATEGORY_HANDLE,
  });
  if (!category) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          { name: "Docking stations", handle: CATEGORY_HANDLE, is_active: true },
        ],
      },
    });
    category = result[0];
  }

  // Products ------------------------------------------------------------------
  const shippingLine = `Shipping: ${supplier.shipping.label} $${supplier.shipping.rate.toFixed(
    2
  )} per order, free on orders of $${supplier.shipping.free_threshold.toLocaleString(
    "en-US"
  )} or more.`;

  const variantIdsByKey: Record<string, string> = {};

  for (const product of catalog.products) {
    const offer = supplier.offers[product.key];
    if (!offer) {
      continue;
    }

    const metadata = {
      brand: product.brand,
      mpn: product.mpn,
      lead_time_business_days: offer.lead_time_days,
      warehouse: supplier.warehouse,
      shipping: shippingLine,
      contract_tiers: offer.tiers,
      ...Object.fromEntries(
        Object.entries(product.specs).map(([key, value]) => [`spec_${key}`, value])
      ),
    };
    const variantMetadata = { mpn: product.mpn };
    const description = describe(product, offer, shippingLine);
    const listPrice = [{ currency_code: currency, amount: usd(offer.list_price) }];

    const [existing] = await productModule.listProducts(
      { handle: product.key },
      { relations: ["variants"] }
    );

    if (!existing) {
      const { result } = await createProductsWorkflow(container).run({
        input: {
          products: [
            {
              title: product.title,
              handle: product.key,
              subtitle: product.brand,
              description,
              status: ProductStatus.PUBLISHED,
              category_ids: [category.id],
              shipping_profile_id: shippingProfile.id,
              metadata,
              options: [{ title: "Package", values: ["Standard"] }],
              variants: [
                {
                  title: "Standard",
                  sku: offer.sku,
                  manage_inventory: true,
                  allow_backorder: false,
                  options: { Package: "Standard" },
                  metadata: variantMetadata,
                  prices: listPrice,
                },
              ],
              sales_channels: [{ id: salesChannel.id }],
            },
          ],
        },
      });
      variantIdsByKey[product.key] = result[0].variants[0].id;
    } else {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: existing.id },
          update: {
            title: product.title,
            subtitle: product.brand,
            description,
            status: ProductStatus.PUBLISHED,
            metadata,
          },
        },
      });
      const variant = existing.variants[0];
      await updateProductVariantsWorkflow(container).run({
        input: {
          selector: { id: variant.id },
          update: {
            sku: offer.sku,
            metadata: variantMetadata,
            prices: listPrice,
          },
        },
      });
      variantIdsByKey[product.key] = variant.id;
    }
  }

  // Stock: available quantity is reset to the catalog number. Reservations of
  // open orders stay in place, so stocked = available + reserved.
  const { data: variantsWithInventory } = await query.graph({
    entity: "variant",
    fields: ["id", "inventory_items.inventory_item_id"],
    filters: { id: Object.values(variantIdsByKey) },
  });
  const inventoryByVariant = new Map(
    variantsWithInventory.map((variant: any) => [
      variant.id,
      variant.inventory_items?.[0]?.inventory_item_id as string,
    ])
  );

  for (const product of catalog.products) {
    const offer = supplier.offers[product.key];
    const variantId = variantIdsByKey[product.key];
    if (!offer || !variantId) {
      continue;
    }
    const inventoryItemId = inventoryByVariant.get(variantId);
    if (!inventoryItemId) {
      throw new Error(`No inventory item for ${product.key}`);
    }
    const [level] = await inventoryModule.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: stockLocation.id,
    });
    if (!level) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: [
            {
              inventory_item_id: inventoryItemId,
              location_id: stockLocation.id,
              stocked_quantity: offer.stock,
            },
          ],
        },
      });
    } else {
      await updateInventoryLevelsWorkflow(container).run({
        input: {
          updates: [
            {
              id: level.id,
              inventory_item_id: inventoryItemId,
              location_id: stockLocation.id,
              stocked_quantity: offer.stock + Number(level.reserved_quantity ?? 0),
            },
          ],
        },
      });
    }
  }

  // Buyer company, customer group, contract price list -----------------------
  const buyer = catalog.buyer;

  let [group] = await customerModule.listCustomerGroups({ name: buyer.company });
  if (!group) {
    const { result } = await createCustomerGroupsWorkflow(container).run({
      input: { customersData: [{ name: buyer.company }] },
    });
    group = result[0];
  }

  const existingLists = (
    await pricingModule.listPriceLists({}, { take: null })
  ).filter((list) => list.title === PRICE_LIST_TITLE);
  if (existingLists.length) {
    await deletePriceListsWorkflow(container).run({
      input: { ids: existingLists.map((list) => list.id) },
    });
  }

  const contractPrices = catalog.products.flatMap((product) => {
    const offer = supplier.offers[product.key];
    const variantId = variantIdsByKey[product.key];
    if (!offer || !variantId) {
      return [];
    }
    return [
      { variant_id: variantId, currency_code: currency, amount: usd(offer.contract_price) },
      ...offer.tiers.map((tier) => ({
        variant_id: variantId,
        currency_code: currency,
        amount: usd(tier.price),
        rules: {
          [lineQtyRuleAttribute(variantId)]: [
            { operator: "gte", value: tier.min_qty },
          ],
        },
      })),
    ];
  });

  await createPriceListsWorkflow(container).run({
    input: {
      price_lists_data: [
        {
          title: PRICE_LIST_TITLE,
          description: `Contract and volume pricing for ${buyer.company}. Volume tiers apply per cart line.`,
          // Price lists default to type "sale": list price stays visible as
          // the original price next to the contract price.
          status: "active",
          rules: { "customer.groups.id": [group.id] },
          prices: contractPrices as any,
        },
      ],
    },
  });

  let [company] = await companyModule.listCompanies({ name: buyer.company });
  if (!company) {
    const { result } = await createCompaniesWorkflow(container).run({
      input: [
        {
          name: buyer.company,
          email: buyer.company_email,
          phone: buyer.contact.phone,
          address: `${buyer.address.address_1}, ${buyer.address.address_2}`,
          city: buyer.address.city,
          state: buyer.address.province,
          zip: buyer.address.postal_code,
          country: buyer.address.country_code,
          currency_code: currency,
          logo_url: null,
          spending_limit_reset_frequency: "monthly",
        } as any,
      ],
    });
    company = result[0];
  }

  const {
    data: [companyWithGroup],
  } = await query.graph({
    entity: "company",
    fields: ["id", "customer_group.id"],
    filters: { id: company.id },
  });
  if (!companyWithGroup?.customer_group?.id) {
    await addCompanyToCustomerGroupWorkflow(container).run({
      input: { company_id: company.id, group_id: group.id },
    });
  }

  // Buyer account ---------------------------------------------------------------
  const buyerEmail = env("NORTHWIND_BUYER_EMAIL").toLowerCase();
  const buyerPassword = env("NORTHWIND_BUYER_PASSWORD");

  let [customer] = await customerModule.listCustomers({
    email: buyerEmail,
    has_account: true,
  });
  if (!customer) {
    const authIdentityId = await registerEmailPass(
      authModule,
      buyerEmail,
      buyerPassword
    );
    const { result } = await createCustomerAccountWorkflow(container).run({
      input: {
        authIdentityId,
        customerData: {
          email: buyerEmail,
          first_name: buyer.contact.first_name,
          last_name: buyer.contact.last_name,
          phone: buyer.contact.phone,
          company_name: buyer.company,
        },
      },
    });
    customer = result;
  } else {
    await setEmailPassPassword(authModule, buyerEmail, buyerPassword);
  }

  const {
    data: [customerWithEmployee],
  } = await query.graph({
    entity: "customer",
    fields: ["id", "employee.id", "groups.id", "addresses.id"],
    filters: { id: customer.id },
  });
  if (!customerWithEmployee?.employee?.id) {
    await createEmployeesWorkflow(container).run({
      input: {
        customerId: customer.id,
        employeeData: {
          company_id: company.id,
          is_admin: true,
          spending_limit: 0,
        } as any,
      },
    });
  }
  const inGroup = (customerWithEmployee?.groups ?? []).some(
    (g: any) => g?.id === group.id
  );
  if (!inGroup) {
    await customerModule.addCustomerToGroup({
      customer_id: customer.id,
      customer_group_id: group.id,
    });
  }
  if (!customerWithEmployee?.addresses?.length) {
    await createCustomerAddressesWorkflow(container).run({
      input: {
        addresses: [
          {
            customer_id: customer.id,
            address_name: "Headquarters",
            first_name: buyer.contact.first_name,
            last_name: buyer.contact.last_name,
            phone: buyer.contact.phone,
            ...buyer.address,
            is_default_shipping: true,
            is_default_billing: true,
          },
        ],
      },
    });
  }

  // Admin user ------------------------------------------------------------------
  const adminEmail = env("NORTHWIND_ADMIN_EMAIL").toLowerCase();
  const adminPassword = env("NORTHWIND_ADMIN_PASSWORD");
  const [adminUser] = await userModule.listUsers({ email: adminEmail });
  if (!adminUser) {
    const authIdentityId = await registerEmailPass(
      authModule,
      adminEmail,
      adminPassword
    );
    await createUserAccountWorkflow(container).run({
      input: {
        authIdentityId,
        userData: { email: adminEmail, first_name: "Northwind", last_name: "Admin" },
      },
    });
  } else {
    await setEmailPassPassword(authModule, adminEmail, adminPassword);
  }

  logger.info(
    `Northwind seeded: ${Object.keys(variantIdsByKey).length} products, price list "${PRICE_LIST_TITLE}", buyer ${buyerEmail}, admin ${adminEmail}`
  );
}

async function registerEmailPass(
  authModule: any,
  email: string,
  password: string
): Promise<string> {
  const { success, authIdentity, error } = await authModule.register("emailpass", {
    body: { email, password },
  });
  if (success && authIdentity) {
    return authIdentity.id;
  }
  // An identity left over from an earlier, interrupted run is reused.
  const [providerIdentity] = await authModule.listProviderIdentities({
    entity_id: email,
    provider: "emailpass",
  });
  if (!providerIdentity) {
    throw new Error(`Could not register ${email}: ${error ?? "unknown error"}`);
  }
  await setEmailPassPassword(authModule, email, password);
  return providerIdentity.auth_identity_id;
}

async function setEmailPassPassword(
  authModule: any,
  email: string,
  password: string
) {
  const { success, error } = await authModule.updateProvider("emailpass", {
    entity_id: email,
    password,
  });
  if (!success) {
    throw new Error(`Could not update password for ${email}: ${error ?? "unknown error"}`);
  }
}
