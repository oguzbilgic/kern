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

  async onBeforeContext(_info: BeforeContextInfo, ctx: PluginContext): Promise<ContextInjection[]> {
    // Rescan every turn — agent may have created/deleted skills mid-session
    catalog = await scanSkills(ctx.agentDir);
    setCatalog(catalog);

    if (catalog.length === 0) return [];

    const injections: ContextInjection[] = [];

    // Compact catalog with paths and active state
    const catalogLines = catalog.map((s) => {
      const state = isActive(s.name) ? "active" : "available";
      const relPath = s.source === "installed"
        ? `.agents/skills/${s.name}/SKILL.md`
        : `skills/${s.name}/SKILL.md`;
      return `${state === "active" ? "✦" : "○"} ${s.name} (${state}): ${s.description || "(no description)"}\n  ${relPath}`;
    });
    injections.push({
      label: "skills",
      content: catalogLines.join("\n"),
      placement: "system",
    });

    // Active skills: injected as <document> blocks (no label — content is pre-wrapped)
    for (const skill of catalog) {
      if (!isActive(skill.name)) continue;
      const relPath = skill.source === "installed"
        ? `.agents/skills/${skill.name}/SKILL.md`
        : `skills/${skill.name}/SKILL.md`;
      const safePath = relPath.replace(/"/g, '&quot;');
      injections.push({
        label: "",
        content: `<document path="${safePath}">\n${skill.body}\n</document>`,
        placement: "system",
      });
    }

    return injections;
  },

  onStatus(_ctx) {
    return {
      skills: `${getActiveSkills().size} active / ${catalog.length} total`,
    };
  },
};
