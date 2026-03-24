import { tool } from "ai";
import { z } from "zod";
import { glob as globFn } from "glob";

export const globTool = tool({
  description:
    'Find files matching a glob pattern. Returns matching file paths. Example patterns: "**/*.ts", "src/**/*.md".',
  inputSchema: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (default: working directory)"),
  }),
  execute: async ({ pattern, path }) => {
    try {
      const matches = await globFn(pattern, {
        cwd: path || process.cwd(),
        absolute: true,
        nodir: true,
      });
      if (matches.length === 0) return "No files matched the pattern.";
      return matches.join("\n");
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
