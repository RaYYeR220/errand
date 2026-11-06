import type { NextConfig } from "next";

const orchestrator = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  // The browser talks to one origin; the orchestrator API is proxied behind it.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${orchestrator}/api/:path*` }];
  },
};

export default nextConfig;
