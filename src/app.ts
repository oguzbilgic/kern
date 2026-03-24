import { Runtime } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { CliInterface } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
import type { Interface } from "./interfaces/types.js";

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

  const handler = async (msg: { text: string; userId: string; chatId: string }) => {
    console.log(`[${new Date().toISOString()}] ${msg.userId}: ${msg.text}`);

    const response = await runtime.handleMessage(msg.text, {
      onText: () => {},
      onFinish: (text) => {
        console.log(
          `[${new Date().toISOString()}] response: ${text.slice(0, 100)}...`,
        );
      },
      onError: (error) => {
        console.error(`[${new Date().toISOString()}] error:`, error.message);
      },
    });

    return response;
  };

  console.log(`kern running in ${agentDir}`);
  console.log(`Session: ${runtime.getSessionId()}`);
  console.log(`Model: ${config.provider}/${config.model}`);
  console.log(`Tools: ${config.tools.join(", ")}`);
  console.log(`Interface: ${telegramToken ? "telegram" : "cli"}`);

  await iface.start(handler);
}
