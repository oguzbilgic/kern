import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

export interface GlobalConfig {
  web_port: number;
  web_host: string;
  hub_port: number;
}

const defaults: GlobalConfig = {
  web_port: 9000,
  web_host: "0.0.0.0",
  hub_port: 4000,
};

const CONFIG_FILE = join(homedir(), ".kern", "config.json");

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const userConfig = JSON.parse(raw);
    return { ...defaults, ...userConfig };
  } catch {
    return defaults;
  }
}
