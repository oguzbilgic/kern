import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export const writeTool = tool({
  description:
    "Write content to a file. Creates the file if it doesn't exist. Creates parent directories as needed. Overwrites existing content.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to write"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async ({ path, content }) => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return `Wrote ${content.split("\n").length} lines to ${path}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
