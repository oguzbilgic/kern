import type { Command } from "./commands.js";

export const proxyCommand: Command = {
  async handler(args) {
    const subcmd = args[0];
    if (subcmd === "start" || subcmd === "stop" || subcmd === "restart") {
      const { getProxyServiceStatus } = await import("./install.js");
      if (getProxyServiceStatus() !== null) {
        const { spawnSync } = await import("child_process");
        const result = spawnSync("systemctl", ["--user", subcmd, "kern-proxy"], { stdio: "inherit" });
        if (result.error) {
          console.error("systemctl failed:", result.error.message);
          process.exit(1);
        }
        if (result.status !== 0) process.exit(result.status ?? 1);
        return;
      }
      const { proxyStart, proxyStop } = await import("./proxy-daemon.js");
      if (subcmd === "start") await proxyStart();
      else if (subcmd === "stop") await proxyStop();
      else { await proxyStop(); await new Promise((r) => setTimeout(r, 500)); await proxyStart(); }
    } else if (subcmd === "status") {
      const { proxyStatus } = await import("./proxy-daemon.js");
      await proxyStatus();
    } else if (subcmd === "token") {
      const { proxyToken } = await import("./proxy-daemon.js");
      await proxyToken();
    } else {
      console.error("Usage: kern proxy <start|stop|restart|status|token>");
      process.exit(1);
    }
  },
};
