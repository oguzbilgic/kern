import { tool } from "ai";
import { z } from "zod";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

export const renderTool = tool({
  description:
    "Render rich visual content (HTML) in the web UI. Two modes:\n" +
    "1. Inline: provide `html` for one-off visuals in the chat (status cards, tables, charts).\n" +
    "2. Dashboard: provide `dashboard` name to display a persistent dashboard from dashboards/<name>/index.html.\n" +
    "   Dashboards are created with the write tool first, then displayed with render.\n" +
    "Use `target` to control where it appears: 'inline' shows in chat, 'panel' opens/refreshes a side panel.",
  inputSchema: z.object({
    html: z
      .string()
      .optional()
      .describe("Raw HTML to render inline. Self-contained with inline styles."),
    dashboard: z
      .string()
      .optional()
      .describe("Dashboard name — loads dashboards/<name>/index.html"),
    target: z
      .enum(["inline", "panel"])
      .optional()
      .default("inline")
      .describe('Where to render: "inline" in chat or "panel" as persistent side panel'),
    title: z
      .string()
      .optional()
      .describe("Optional title for the render block"),
  }),
  execute: async ({ html, dashboard, target, title }) => {
    // Validate: must provide html or dashboard
    if (!html && !dashboard) {
      return "Error: provide either `html` or `dashboard` parameter";
    }

    if (dashboard) {
      const dashDir = join(process.cwd(), "dashboards", dashboard);
      const indexPath = join(dashDir, "index.html");
      if (!existsSync(indexPath)) {
        return `Error: dashboard not found at dashboards/${dashboard}/index.html — create it with the write tool first`;
      }
      // Read the dashboard HTML
      html = readFileSync(indexPath, "utf-8");

      // Inject data.json if it exists
      const dataPath = join(dashDir, "data.json");
      if (existsSync(dataPath)) {
        const data = readFileSync(dataPath, "utf-8");
        // Inject as a script tag before closing </head> or at start
        const dataScript = `<script>window.__KERN_DATA__ = ${data};</script>`;
        if (html.includes("</head>")) {
          html = html.replace("</head>", `${dataScript}</head>`);
        } else {
          html = dataScript + html;
        }
      }
    }

    // The actual rendering is handled by the UI via SSE event
    // Tool result contains metadata for the UI to process
    return JSON.stringify({
      __kern_render: true,
      html,
      dashboard: dashboard || null,
      target: target || "inline",
      title: title || dashboard || "Render",
    });
  },
});
