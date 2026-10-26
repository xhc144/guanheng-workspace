import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  output: "standalone",
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
