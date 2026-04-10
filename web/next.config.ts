import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // No trailing slashes — our web server handles routing
  trailingSlash: false,
  // Scope Turbopack to web/ so it doesn't pick up src/proxy.ts from parent
  turbopack: {
    root: ".",
  },
};

export default nextConfig;
