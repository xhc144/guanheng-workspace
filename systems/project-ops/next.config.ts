import type { NextConfig } from "next";
import { getBasePath } from "./lib/base-path.ts";

const nextConfig: NextConfig = {
  basePath: getBasePath(),
  output: "standalone",
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
