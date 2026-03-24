import { execSync } from "child_process";
import { basename, resolve, join } from "path";
import { existsSync } from "fs";
import { findAgent, loadRegistry, registerAgent, isProcessRunning, setPid } from "./registry.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export async function backupAgent(nameOrPath?: string): Promise<void> {
  if (!nameOrPath) {
    console.error("Usage: kern backup <name>");
    process.exit(1);
  }

  const agent = await findAgent(nameOrPath);
  if (!agent) {
    console.error(`Agent not found: ${nameOrPath}`);
    process.exit(1);
  }

  const agentDir = agent.path;
  const parentDir = resolve(agentDir, "..");
  const folderName = basename(agentDir);
  const date = new Date().toISOString().slice(0, 10);
  const tarName = `${agent.name}-${date}.tar.gz`;
  const tarPath = resolve(tarName);

  console.log("");
  console.log(`  ${bold("kern backup")} ${agent.name}`);
  console.log(`  ${dim(agentDir)} → ${tarName}`);

  try {
    execSync(
      `tar czf "${tarPath}" --exclude='.kern/logs' -C "${parentDir}" "${folderName}/"`,
      { stdio: "pipe" },
    );
    console.log(`  ${green("✓")} ${tarName}`);
  } catch (e: any) {
    console.error(`  ${red("✗")} backup failed: ${e.message}`);
    process.exit(1);
  }

  console.log("");
  process.exit(0);
}

export async function restoreAgent(tarFile?: string): Promise<void> {
  if (!tarFile) {
    console.error("Usage: kern restore <file.tar.gz>");
    process.exit(1);
  }

  if (!existsSync(tarFile)) {
    console.error(`File not found: ${tarFile}`);
    process.exit(1);
  }

  // Peek inside tar to get folder name
  let folderName = "";
  try {
    const listing = execSync(`tar tzf "${tarFile}" | head -1`, { encoding: "utf-8" }).trim();
    folderName = listing.split("/")[0];
  } catch {
    console.error("Could not read archive.");
    process.exit(1);
  }

  if (!folderName) {
    console.error("Could not determine agent name from archive.");
    process.exit(1);
  }

  const targetDir = resolve(folderName);

  console.log("");
  console.log(`  ${bold("kern restore")} ${folderName}`);
  console.log(`  ${dim(tarFile)} → ${targetDir}`);

  // Check if agent exists
  const existing = await findAgent(folderName);
  if (existing || existsSync(targetDir)) {
    const { confirm } = await import("@inquirer/prompts");
    const existsWhere = existing ? `in registry (${existing.path})` : `at ${targetDir}`;
    const yes = await confirm({
      message: `${folderName} already exists ${existsWhere}. Overwrite?`,
      default: false,
    });
    if (!yes) {
      console.log("  Aborted.");
      process.exit(0);
    }

    // Stop if running
    if (existing?.pid && isProcessRunning(existing.pid)) {
      try {
        process.kill(existing.pid, "SIGTERM");
        await setPid(folderName, null);
        console.log(`  ${yellow("●")} stopped running agent`);
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Extract
  try {
    execSync(`tar xzf "${tarFile}" -C "${resolve(".")}"`, { stdio: "pipe" });
    console.log(`  ${green("✓")} extracted`);
  } catch (e: any) {
    console.error(`  ${red("✗")} extract failed: ${e.message}`);
    process.exit(1);
  }

  // Register
  await registerAgent(folderName, targetDir);
  console.log(`  ${green("✓")} registered`);

  console.log("");
  console.log(`  Run: ${dim(`kern start ${folderName}`)}`);
  console.log("");
  process.exit(0);
}
