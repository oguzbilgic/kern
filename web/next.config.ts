import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // No trailing slashes — our web server handles routing
  trailingSlash: false,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
