import type { KernPlugin, PluginContext, RouteHandler, BeforeContextInfo, ContextInjection } from "../types.js";
import { loadNotesContext, regenerateNotesSummary } from "./notes.js";
import { log } from "../../log.js";

function wrapDocument(path: string, content: string): string {
  return `<document path="${path}">\n${content.trim()}\n</document>`;
}

function wrapNotesSummary(content: string): string {
  return `<notes_summary>\n${content.trim()}\n</notes_summary>`;
}

// Cached notes context for system prompt injection
let cachedNotes: { latest: string | null; latestFile: string | null; summary: string | null } = {
  latest: null,
  latestFile: null,
  summary: null,
};

export const notesPlugin: KernPlugin = {
  name: "notes",

  routes: (() => {
    let _ctx: PluginContext | null = null;

    const routes: RouteHandler[] = [
      {
        method: "GET",
        path: "/summaries",
        handler: (_req, res) => {
          if (!_ctx) { res.writeHead(500); res.end(); return; }
          const summaries = _ctx.db.getAllSummaries("daily_notes");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(summaries));
        },
      },
      {
        method: "POST",
        path: "/summaries/regenerate",
        handler: async (_req, res) => {
          if (!_ctx) { res.writeHead(500); res.end(); return; }
          try {
            const result = await regenerateNotesSummary(_ctx.agentDir, _ctx.config, _ctx.db);
            // Refresh cache after regeneration
            cachedNotes = await loadNotesContext(_ctx.agentDir, _ctx.config, _ctx.db);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        },
      },
    ];

    // Attach context setter
    (routes as any)._setCtx = (ctx: PluginContext) => { _ctx = ctx; };
    return routes;
  })(),

  async onStartup(ctx) {
    // Wire route context
    (this.routes as any)?._setCtx(ctx);

    // Load notes context into cache
    try {
      cachedNotes = await loadNotesContext(ctx.agentDir, ctx.config, ctx.db);
      if (cachedNotes.latest) log("notes", `loaded latest note: ${cachedNotes.latestFile}`);
      if (cachedNotes.summary) log("notes", `loaded notes summary (${cachedNotes.summary.length} chars)`);
    } catch (err: any) {
      log.error("notes", `failed to load notes context: ${err.message}`);
    }
  },

  async onBeforeContext(_info: BeforeContextInfo, ctx: PluginContext): Promise<ContextInjection | null> {
    // Refresh notes context each time (handles background regeneration)
    try {
      cachedNotes = await loadNotesContext(ctx.agentDir, ctx.config, ctx.db);
    } catch (err: any) {
      log.error("notes", `failed to refresh notes context: ${err.message}`);
    }

    const parts: string[] = [];

    if (cachedNotes.summary) {
      parts.push(wrapNotesSummary(cachedNotes.summary));
    }
    if (cachedNotes.latest && cachedNotes.latestFile) {
      parts.push(wrapDocument(`notes/${cachedNotes.latestFile}`, cachedNotes.latest));
    }

    if (parts.length === 0) return null;

    return {
      label: "notes",
      content: parts.join("\n\n"),
      placement: "system",
    };
  },
};
