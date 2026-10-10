import type { NextConfig } from "next";

// The browser only talks to this Next.js server; /api is proxied to FastAPI so keys stay server-side.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
