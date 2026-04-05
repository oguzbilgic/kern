import { tool } from "ai";
import { z } from "zod";
import { readFile, readdir, stat } from "fs/promises";
import { extname } from "path";

async function readPdf(
  filePath: string,
  offset: number,
  limit: number,
): Promise<string> {
  const { extractText } = await import("unpdf");
  const buffer = await readFile(filePath);
  const data = new Uint8Array(buffer);
  const { totalPages, text } = await extractText(data, {
    mergePages: true,
  });
  const header = `[PDF: ${totalPages} pages]`;
  const lines = (text as string).split("\n");
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
  return `${header}\n${numbered}`;
}

export const readTool = tool({
  description:
    "Read a file or list a directory. Returns file contents with line numbers, or directory entries with trailing / for subdirectories.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to read"),
    offset: z
      .number()
      .optional()
      .describe("Line number to start from (1-indexed, default: 1)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of lines to read (default: 2000)"),
  }),
  execute: async ({ path, offset = 1, limit = 2000 }) => {
    try {
      const s = await stat(path);
      if (s.isDirectory()) {
        const entries = await readdir(path, { withFileTypes: true });
        return entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join("\n");
      }
      if (extname(path).toLowerCase() === ".pdf") {
        return await readPdf(path, offset, limit);
      }
      const content = await readFile(path, "utf-8");
      const lines = content.split("\n");
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      return slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
