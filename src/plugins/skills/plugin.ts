import type { KernPlugin, PluginContext, RouteHandler, BeforeContextInfo, ContextInjection } from "../types.js";
import { scanSkills, type SkillInfo } from "./scanner.js";
import { isActive, getActiveSkills } from "./state.js";
import { skillTool, setCatalog } from "./tool.js";
import { log } from "../../log.js";

/** Cached skill catalog */
let catalog: SkillInfo[] = [];

/**
 * Skills plugin — progressive disclosure skill system.
 *
 * Scans skills/ (agent-created) and .agents/skills/ (installed) directories.
 * Injects compact catalog into system prompt. Full skill content injected
 * only when agent explicitly activates a skill.
 */
export const skillsPlugin: KernPlugin = {
  name: "skills",

  tools: {
    skill: skillTool,
  },

  routes: (() => {
    let _ctx: PluginContext | null = null;

    const routes: RouteHandler[] = [
      {
        method: "GET",
        path: "/skills",
        handler: (_req, res) => {
          const active = getActiveSkills();
          const result = catalog.map((s) => ({
            name: s.name,
            description: s.description,
            source: s.source,
            active: active.has(s.name),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        },
      },
      {
        method: "GET",
        path: /^\/skills\/([^/]+)$/,
        handler: (_req, res, match) => {
          const name = match?.[1];
          const skill = catalog.find((s) => s.name === name);
          if (!skill) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Skill not found" }));
            return;
          }
          const active = getActiveSkills();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            name: skill.name,
            description: skill.description,
            source: skill.source,
            active: active.has(skill.name),
            body: skill.body,
          }));
        },
      },
    ];

    (routes as any)._setCtx = (ctx: PluginContext) => { _ctx = ctx; };
    return routes;
  })(),

  async onStartup(ctx) {
    (this.routes as any)?._setCtx(ctx);

    // Scan skill directories
    catalog = await scanSkills(ctx.agentDir);
    setCatalog(catalog);

    if (catalog.length > 0) {
      const active = getActiveSkills();
      log("skills", `found ${catalog.length} skill(s), ${active.size} active`);
    }
  },

  async onBeforeContext(_info: BeforeContextInfo, _ctx: PluginContext): Promise<ContextInjection | null> {
    if (catalog.length === 0) return null;

    const parts: string[] = [];

    // Always: compact catalog
    const catalogLines = catalog.map((s) => {
      const marker = isActive(s.name) ? "✦" : "-";
      return `${marker} ${s.name}: ${s.description || "(no description)"}`;
    });
    parts.push("# Available Skills\n" + catalogLines.join("\n"));

    // Active skills: full content
    for (const skill of catalog) {
      if (!isActive(skill.name)) continue;
      parts.push(`# Active Skill: ${skill.name}\n\n${skill.body}`);
    }

    return {
      label: "skills",
      content: parts.join("\n\n"),
      placement: "system",
    };
  },

  onStatus(_ctx) {
    return {
      skills: `${getActiveSkills().size} active / ${catalog.length} total`,
    };
  },
};
