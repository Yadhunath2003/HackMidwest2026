import type { NextConfig } from "next";

// The browser only talks to this Next.js server; /api is proxied to FastAPI so keys stay server-side.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // AI calls (reports, trade explanations, generation) can take 30-60 s; the proxy default of 30 s cut them off with a 500.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
