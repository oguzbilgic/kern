import { Runtime } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { CliInterface, dim, bold, cyan } from "./interfaces/cli.js";
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
  const isCli = !telegramToken;

  if (telegramToken) {
    const allowedUsers = config.telegram?.allowedUsers || [];
    iface = new TelegramInterface(telegramToken, allowedUsers);
  } else {
    iface = new CliInterface();
  }

  const handler = async (msg: { text: string; userId: string; chatId: string }) => {
    if (!isCli) {
      console.log(`[${new Date().toISOString()}] ${msg.userId}: ${msg.text}`);
    }

    try {
      const response = await runtime.handleMessage(msg.text, {
        onText: () => {},
        onFinish: (text) => {
          if (!isCli) {
            console.log(
              `[${new Date().toISOString()}] response: ${text.slice(0, 100)}...`,
            );
          }
        },
        onError: (error) => {
          console.error(`Error: ${error.message}`);
        },
      });

      return response;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  };

  console.log(bold("kern") + " " + dim(agentDir));
  console.log(dim(`session  ${runtime.getSessionId()}`));
  console.log(dim(`model    ${config.provider}/${config.model}`));
  console.log(dim(`tools    ${config.tools.join(", ")}`));
  console.log("");

  await iface.start({ onMessage: handler, history: runtime.getMessages() });
}
