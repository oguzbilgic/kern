import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import type { RouteHandler } from "../types.js";

/**
 * Dashboard HTTP routes.
 * Serves dashboard files, lists available dashboards, injects data.json.
 */
export function createDashboardRoutes(agentDir: string): RouteHandler[] {
  return [
    // List available dashboards: GET /dashboards
    {
      method: "GET",
      path: "/dashboards",
      handler: (_req, res) => {
        const dashDir = join(agentDir, "dashboards");
        let dashboards: string[] = [];
        if (existsSync(dashDir)) {
          dashboards = readdirSync(dashDir, { withFileTypes: true })
            .filter((d: any) => d.isDirectory() && existsSync(join(dashDir, d.name, "index.html")))
            .map((d: any) => d.name);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dashboards }));
      },
    },

    // Serve dashboard files: GET /d/<name>/ or /d/<name>/data.json
    {
      method: "GET",
      path: /^\/d\/([a-zA-Z0-9_-]+)(\/.*)?$/,
      handler: (_req, res, match) => {
        if (!match) { res.writeHead(404); res.end("not found"); return; }
        const dashName = match[1];
        const subPath = match[2] || "/";
        const dashDir = join(agentDir, "dashboards", dashName);

        if (!existsSync(dashDir)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `dashboard '${dashName}' not found` }));
          return;
        }

        let filePath: string;
        let contentType: string;
        if (subPath === "/" || subPath === "/index.html") {
          filePath = join(dashDir, "index.html");
          contentType = "text/html; charset=utf-8";
        } else if (subPath === "/data.json") {
          filePath = join(dashDir, "data.json");
          contentType = "application/json; charset=utf-8";
        } else {
          filePath = join(dashDir, subPath.slice(1));
          const ext = filePath.split(".").pop() || "";
          const mimeMap: Record<string, string> = {
            html: "text/html", css: "text/css", js: "application/javascript",
            json: "application/json", svg: "image/svg+xml", png: "image/png",
          };
          contentType = mimeMap[ext] || "application/octet-stream";
        }

        // Prevent path traversal
        if (!filePath.startsWith(dashDir)) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }

        if (existsSync(filePath)) {
          let content: string | Buffer = readFileSync(filePath);
          // Inject data.json into index.html if available
          if ((subPath === "/" || subPath === "/index.html") && contentType.startsWith("text/html")) {
            const dataPath = join(dashDir, "data.json");
            if (existsSync(dataPath)) {
              const jsonData = readFileSync(dataPath, "utf-8");
              const dataScript = `<script>window.__KERN_DATA__ = ${jsonData};</script>`;
              let html = content.toString("utf-8");
              html = html.includes("</head>") ? html.replace("</head>", `${dataScript}</head>`) : dataScript + html;
              content = html;
            }
          }
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content);
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file not found" }));
        }
      },
    },
  ];
}
