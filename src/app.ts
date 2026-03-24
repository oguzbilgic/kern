import { Runtime } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { loadConfig } from "./config.js";

export async function startApp(agentDir: string): Promise<void> {
  const config = await loadConfig(agentDir);
  const runtime = new Runtime(agentDir);
  await runtime.init();

  // Set working directory to agent dir so tools operate there
  process.chdir(agentDir);

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    console.error("TELEGRAM_BOT_TOKEN not set in .kern/.env");
    process.exit(1);
  }

  const allowedUsers = config.telegram?.allowedUsers || [];

  const telegram = new TelegramInterface(telegramToken, allowedUsers);

  await telegram.start(async (msg) => {
    console.log(`[${new Date().toISOString()}] ${msg.userId}: ${msg.text}`);

    const response = await runtime.handleMessage(msg.text, {
      onText: () => {}, // TODO: wire up streaming edits
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
  });

  console.log(`kern running in ${agentDir}`);
  console.log(`Session: ${runtime.getSessionId()}`);
  console.log(`Model: ${config.provider}/${config.model}`);
  console.log(`Tools: ${config.tools.join(", ")}`);
  if (allowedUsers.length > 0) {
    console.log(`Allowed users: ${allowedUsers.join(", ")}`);
  }
}
