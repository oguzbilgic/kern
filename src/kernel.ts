import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const BUNDLED_AGENTS = join(import.meta.dirname, "..", "AGENTS.md");

function extractVersion(content: string): string | null {
  const match = content.match(/<!-- kernel: (v[\d.]+) -->/);
  return match ? match[1] : null;
}

export async function updateKernel(agentDir: string): Promise<void> {
  if (!existsSync(BUNDLED_AGENTS)) return;

  const bundled = await readFile(BUNDLED_AGENTS, "utf-8");
  const bundledVersion = extractVersion(bundled);
  if (!bundledVersion) return;

  const agentFile = join(agentDir, "AGENTS.md");

  if (!existsSync(agentFile)) {
    // No AGENTS.md — write it
    await writeFile(agentFile, bundled);
    console.log(`[kern] wrote AGENTS.md (kernel ${bundledVersion})`);
    return;
  }

  const current = await readFile(agentFile, "utf-8");
  const currentVersion = extractVersion(current);

  if (currentVersion === bundledVersion) return;

  // Different version or no version marker — update
  await writeFile(agentFile, bundled);
  if (currentVersion) {
    console.log(`[kern] updated AGENTS.md: kernel ${currentVersion} → ${bundledVersion}`);
  } else {
    console.log(`[kern] updated AGENTS.md to kernel ${bundledVersion}`);
  }
}
