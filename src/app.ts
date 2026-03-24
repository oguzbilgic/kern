import { Runtime } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { CliInterface, dim, bold, cyan } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
import { readFile } from "fs/promises";
import { join } from "path";
import type { Interface, MessageHandler } from "./interfaces/types.js";

export async function startApp(agentDir: string): Promise<void> {
  const config = await loadConfig(agentDir);
  const runtime = new Runtime(agentDir);
  await runtime.init();

  // Set working directory to agent dir so tools operate there
  process.chdir(agentDir);

  // Pick interface: Telegram if token set, otherwise CLI
  let iface: Interface;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  if (telegramToken) {
    const allowedUsers = config.telegram?.allowedUsers || [];
    iface = new TelegramInterface(telegramToken, allowedUsers);
  } else {
    iface = new CliInterface();
  }

  const handler: MessageHandler = async (msg, onEvent) => {
    // Inject context so the model knows who/where
    const context = msg.interface !== "cli"
      ? `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}]\n${msg.text}`
      : msg.text;
    return runtime.handleMessage(context, onEvent);
  };

  const w = (s: string) => process.stdout.write(s + "\n");

  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}

  w("");
  w(`  ${bold("kern")} ${dim("v" + version)} ${cyan(agentDir)}`);
  w(`  ${"model"}    ${dim(config.provider + "/" + config.model)}`);
  w(`  ${"session"}  ${dim(runtime.getSessionId() || "new")}`);
  w(`  ${"tools"}    ${dim(config.toolScope)}`);
  w(`  ${dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`);
  w("");

  await iface.start({ onMessage: handler, history: runtime.getMessages() });
}
