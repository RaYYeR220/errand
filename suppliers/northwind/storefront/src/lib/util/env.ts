/** Public origin of the storefront, e.g. https://northwind.example.com */
export const getBaseURL = () => {
  return process.env.BASE_URL || "http://localhost:8000"
}

/** Cookies are marked Secure whenever the storefront is served over HTTPS. */
export const secureCookies = () => getBaseURL().startsWith("https://")
