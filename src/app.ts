import { Runtime } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { CliInterface, dim, bold, cyan } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
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
    return runtime.handleMessage(msg.text, onEvent);
  };

  const w = (s: string) => process.stdout.write(s + "\n");

  w("");
  w(`  ${bold("kern")} ${cyan(agentDir)}`);
  w(`  ${dim("session")}  ${dim(runtime.getSessionId() || "new")}`);
  w(`  ${dim("model")}    ${dim(config.provider + "/" + config.model)}`);
  w(`  ${dim("tools")}    ${dim(config.tools.join(", "))}`);
  w("");

  await iface.start({ onMessage: handler, history: runtime.getMessages() });
}
