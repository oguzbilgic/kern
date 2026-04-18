import type { Command } from "./commands.js";

export const webCommand: Command = {
  name: "web",
  usage: "<run|start|stop|restart|status>",
  description: "static web UI server",
  async handler(args) {
    const subcmd = args[0];
    if (subcmd === "start" || subcmd === "stop" || subcmd === "restart") {
      const { getWebServiceStatus } = await import("./install.js");
      if (getWebServiceStatus() !== null) {
        const { spawnSync } = await import("child_process");
        const result = spawnSync("systemctl", ["--user", subcmd, "kern-web"], { stdio: "inherit" });
        if (result.error) {
          console.error("systemctl failed:", result.error.message);
          process.exit(1);
        }
        if (result.status !== 0) process.exit(result.status ?? 1);
        return;
      }
      const { webStart, webStop } = await import("./web-daemon.js");
      if (subcmd === "start") await webStart();
      else if (subcmd === "stop") await webStop();
      else { await webStop(); await new Promise((r) => setTimeout(r, 500)); await webStart(); }
    } else if (subcmd === "status") {
      const { webStatus } = await import("./web-daemon.js");
      await webStatus();
    } else if (subcmd === "run") {
      // Foreground mode for Docker
      await import("../web.js");
    } else {
      console.error("Usage: kern web <run|start|stop|restart|status>");
      process.exit(1);
    }
  },
};
