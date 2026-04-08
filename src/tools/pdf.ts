import { tool, generateText } from "ai";
import { z } from "zod";
import { readFile } from "fs/promises";
import { createModel } from "../model.js";
import { loadConfig } from "../config.js";

/**
 * Parse a pages string like "1", "1-5", "1,3,7-9" into sorted unique 0-based indices.
 * Clamps to [1, totalPages].
 */
function parsePages(pages: string, totalPages: number): number[] {
  const result = new Set<number>();
  for (const part of pages.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-");
    if (range.length === 2) {
      const start = Math.max(1, parseInt(range[0], 10));
      const end = Math.min(totalPages, parseInt(range[1], 10));
      if (isNaN(start) || isNaN(end)) continue;
      for (let i = start; i <= end; i++) result.add(i - 1);
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) result.add(num - 1);
    }
  }
  return [...result].sort((a, b) => a - b);
}

export const pdfTool = tool({
  description:
    "Read or analyze a PDF file. Returns extracted text for specified pages with a header showing total page count. Use `prompt` to ask a question about the PDF using the AI model.",
  inputSchema: z.object({
    file: z.string().describe("Path to the PDF file"),
    pages: z
      .string()
      .optional()
      .describe('Page numbers to read, e.g. "1", "1-5", "2,4,7-9" (default: "1")'),
    prompt: z
      .string()
      .optional()
      .describe("Question to ask about the PDF using the AI model. If provided, sends PDF content to the model."),
  }),
  execute: async ({ file, pages, prompt }) => {
    try {
      const { extractText } = await import("unpdf");
      const buffer = await readFile(file);
      const data = new Uint8Array(buffer);
      const { totalPages, text } = await extractText(data, {
        mergePages: false,
      });
      const pageTexts = text as string[];

      // Default: all pages if prompt provided, page 1 if just reading
      const effectivePages = pages || (prompt ? `1-${totalPages}` : "1");
      const indices = parsePages(effectivePages, totalPages);
      if (indices.length === 0) {
        return `Error: no valid pages in range "${pages}" (PDF has ${totalPages} pages)`;
      }

      // Build page label for header
      const pageLabel =
        indices.length === 1
          ? `page ${indices[0] + 1}`
          : `pages ${indices.map((i) => i + 1).join(", ")}`;
      const header = `[PDF: ${totalPages} pages, showing ${pageLabel}]`;

      // Extract text for requested pages
      const extracted = indices
        .map((i) => {
          const pageNum = i + 1;
          const content = pageTexts[i]?.trim() || "(empty page)";
          return `--- Page ${pageNum} ---\n${content}`;
        })
        .join("\n\n");

      // If no prompt, just return extracted text
      if (!prompt) {
        return `${header}\n\n${extracted}`;
      }

      // With prompt: send to model for analysis
      const agentDir = process.cwd();
      const config = await loadConfig(agentDir);
      const model = createModel(config);

      const result = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: `${header}\n\n${extracted}\n\n---\n\n${prompt}`,
          },
        ],
        maxOutputTokens: 2000,
      });

      return `${header}\n\n${result.text.trim()}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
});
