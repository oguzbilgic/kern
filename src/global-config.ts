import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { log } from "./log.js";

export interface GlobalConfig {
  web_port: number;
  web_host: string;
  proxy_port: number;
  agents: string[];
}

const defaults: GlobalConfig = {
  web_port: 8080,
  web_host: "0.0.0.0",
  proxy_port: 9000,
  agents: [],
};

const KERN_DIR = join(homedir(), ".kern");
const CONFIG_FILE = join(KERN_DIR, "config.json");
const LEGACY_AGENTS_FILE = join(KERN_DIR, "agents.json");

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  // Migrate legacy agents.json → config.json on first load
  await migrateLegacyAgents();

  if (!existsSync(CONFIG_FILE)) return { ...defaults };
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const userConfig = JSON.parse(raw);
    return { ...defaults, ...userConfig };
  } catch {
    return { ...defaults };
  }
}

export function loadGlobalConfigSync(): GlobalConfig {
  if (!existsSync(CONFIG_FILE)) return { ...defaults };
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const userConfig = JSON.parse(raw);
    return { ...defaults, ...userConfig };
  } catch {
    return { ...defaults };
  }
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Migrate legacy ~/.kern/agents.json (array of objects) into config.json agents field.
 * Runs once — deletes agents.json after migration.
 */
async function migrateLegacyAgents(): Promise<void> {
  if (!existsSync(LEGACY_AGENTS_FILE)) return;
  try {
    const raw = await readFile(LEGACY_AGENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    // Extract paths from legacy object entries
    const paths: string[] = parsed.map((entry: any) => entry.path).filter(Boolean);

    // Load existing config and merge agents
    let config = { ...defaults };
    if (existsSync(CONFIG_FILE)) {
      try {
        const configRaw = await readFile(CONFIG_FILE, "utf-8");
        config = { ...defaults, ...JSON.parse(configRaw) };
      } catch {}
    }
    config.agents = paths;

    await saveGlobalConfig(config);
    await unlink(LEGACY_AGENTS_FILE);
    log("config", `migrated ${paths.length} agent(s) from agents.json → config.json`);
  } catch (err) {
    log.warn("config", `agents.json migration failed: ${err}`);
  }
}
