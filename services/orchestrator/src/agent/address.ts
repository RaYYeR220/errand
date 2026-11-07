/** A company address-book entry split into the fields checkout forms ask for. */
export interface AddressFields {
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

const UNIT = /^(suite|ste\.?|unit|apt\.?|floor|fl\.?|room|#)\b/i;
const STATE_ZIP = /^([A-Z]{2}) (\d{5}(?:-\d{4})?)$/;

/**
 * "Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105" → fields.
 * Returns null for anything that is not "company, street[, unit], city, ST 12345".
 */
export function parseAddress(line: string): AddressFields | null {
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return null;
  const m = parts[parts.length - 1]!.match(STATE_ZIP);
  if (!m) return null;
  const city = parts[parts.length - 2]!;
  const company = parts[0]!;
  const street = parts.slice(1, -2);
  if (!street.length || street.length > 2) return null;
  const unit = street.length === 2 && UNIT.test(street[1]!) ? street[1]! : "";
  if (street.length === 2 && !unit) return null;
  return { company, address_1: street[0]!, address_2: unit, city, state: m[1]!, zip: m[2]!, country: "United States" };
}

/** The address as checkout instructions for the browser agent: one field per value, nothing to infer. */
export function checkoutAddressInstructions(line: string, contact?: { first_name: string; last_name: string; phone: string }): string {
  const a = parseAddress(line);
  if (!a) return `ship to ${line}`;
  const fields = [
    ...(contact ? [`first name "${contact.first_name}"`, `last name "${contact.last_name}"`, `phone "${contact.phone}"`] : []),
    `company "${a.company}"`,
    a.address_2
      ? `address "${a.address_1}, ${a.address_2}" (if the form has a separate apartment / suite field, put "${a.address_2}" there and "${a.address_1}" in the address field; the suite must not be dropped)`
      : `address "${a.address_1}"`,
    `city "${a.city}"`,
    `state / province "${a.state}"`,
    `ZIP / postal code "${a.zip}"`,
    `country "${a.country}"`,
  ];
  return `ship to ${line}; fill the shipping address fields exactly as: ${fields.join("; ")} (leave any other field as it is)`;
}
