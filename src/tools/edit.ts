import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";

export const editTool = tool({
  description:
    "Make an exact string replacement in a file. The oldString must match exactly (including whitespace and indentation). Use replaceAll to replace every occurrence.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    oldString: z.string().describe("The exact text to find and replace"),
    newString: z.string().describe("The replacement text"),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace all occurrences (default: false)"),
  }),
  execute: async ({ path, oldString, newString, replaceAll = false }) => {
    try {
      const content = await readFile(path, "utf-8");
      if (!content.includes(oldString)) {
        return `Error: oldString not found in ${path}`;
      }
      const count = content.split(oldString).length - 1;
      if (count > 1 && !replaceAll) {
        return `Error: found ${count} matches for oldString. Use replaceAll or provide more context to make it unique.`;
      }
      const updated = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);
      await writeFile(path, updated, "utf-8");
      const replaced = replaceAll ? count : 1;
      return `Replaced ${replaced} occurrence${replaced > 1 ? "s" : ""} in ${path}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
