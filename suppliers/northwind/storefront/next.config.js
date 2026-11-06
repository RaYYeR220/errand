/**
 * Northwind storefront build. Backend URL, publishable key and public base URL
 * are read at runtime (see src/lib/config.ts), so one image serves any
 * hostname.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
}

module.exports = nextConfig
