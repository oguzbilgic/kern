import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // No trailing slashes — our web server handles routing
  trailingSlash: false,
  // Scope to web/ so Turbopack doesn't pick up src/proxy.ts from parent
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: ".",
  },
};

export default nextConfig;
