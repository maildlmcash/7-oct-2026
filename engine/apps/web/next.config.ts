import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/app", permanent: false }];
  },
  // Playwright opens the dev server through localhost and 127.0.0.1.
  // Next.js blocks the dev resource unless this host is named.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "grok.com",
    "**.grok.com",
    "grok-sandbox.com",
    "**.grok-sandbox.com",
  ],
  transpilePackages: ["@crypto-prediction-engine/ui-kit", "@crypto-prediction-engine/contracts"],
};

export default nextConfig;
