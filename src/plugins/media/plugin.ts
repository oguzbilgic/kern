import type { KernPlugin, PluginContext, RouteHandler } from "../types.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { imageTool } from "../../tools/image.js";
import { pdfTool } from "../../tools/pdf.js";
import { log } from "../../log.js";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export const mediaPlugin: KernPlugin = {
  name: "media",

  tools: {
    pdf: pdfTool,
    image: imageTool,
  },

  routes: (() => {
    let _ctx: PluginContext | null = null;

    const routes: RouteHandler[] = [
      {
        method: "GET",
        path: "/media/list",
        handler: (_req, res) => {
          if (!_ctx) { res.writeHead(500); res.end(); return; }
          const files = _ctx.db.getMediaList();
          const stats = _ctx.db.getMediaStats();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ files, stats }));
        },
      },
      {
        method: "GET",
        path: /^\/media\/([a-f0-9]+\.[a-z0-9]+)$/,
        handler: (_req, res, match) => {
          if (!_ctx || !match) { res.writeHead(500); res.end(); return; }
          const filename = match[1];
          const mediaPath = join(_ctx.agentDir, ".kern", "media", filename);
          if (existsSync(mediaPath)) {
            const data = readFileSync(mediaPath);
            const ext = filename.split(".").pop() || "";
            res.writeHead(200, {
              "Content-Type": MIME_MAP[ext] || "application/octet-stream",
              "Cache-Control": "public, max-age=31536000, immutable",
            });
            res.end(data);
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "media not found" }));
          }
        },
      },
    ];

    (routes as any)._setCtx = (ctx: PluginContext) => { _ctx = ctx; };
    return routes;
  })(),

  async onStartup(ctx) {
    (this.routes as any)?._setCtx(ctx);
    log("media", "plugin loaded");
  },

  onStatus(ctx) {
    const stats = ctx.db.getMediaStats();
    return { media: stats };
  },
};
