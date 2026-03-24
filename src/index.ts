#!/usr/bin/env node

// Suppress punycode deprecation warning from transitive dependencies
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning: any, ...args: any[]) => {
  if (typeof warning === "string" && warning.includes("punycode")) return;
  return (originalEmitWarning as any).call(process, warning, ...args);
};

import { resolve } from "path";
import { existsSync } from "fs";
import { startApp } from "./app.js";
import { runInit } from "./init.js";

const args = process.argv.slice(2);

if (args[0] === "init") {
  runInit(args[1]).catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
} else {
  // Determine agent directory
  const agentDir = resolve(args[0] || ".");

  if (!existsSync(agentDir)) {
    console.error(`Directory not found: ${agentDir}`);
    process.exit(1);
  }

  // Check for .kern/ or AGENTS.md to verify it's an agent dir
  const hasKernDir = existsSync(resolve(agentDir, ".kern"));
  const hasAgentsMd = existsSync(resolve(agentDir, "AGENTS.md"));

  if (!hasKernDir && !hasAgentsMd) {
    console.error(`Not an agent directory: ${agentDir}`);
    console.error(
      "Run 'kern init' to set up a new agent, or point to an existing one.",
    );
    process.exit(1);
  }

  startApp(agentDir).catch((error) => {
    console.error("Fatal:", error.message);
    process.exit(1);
  });
}
