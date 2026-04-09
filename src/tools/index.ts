import { bashTool } from "./bash.js";
import { pwshTool } from "./pwsh.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webfetchTool } from "./webfetch.js";
import { websearchTool } from "./websearch.js";
import { kernTool } from "./kern.js";
import { messageTool } from "./message.js";
import { recallTool } from "./recall.js";
import { pdfTool } from "./pdf.js";
import { imageTool } from "./image.js";

const isWindows = process.platform === "win32";

export const allTools = {
  // Platform-specific shell tool — one per platform
  ...(isWindows ? { pwsh: pwshTool } : { bash: bashTool }),
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
  webfetch: webfetchTool,
  websearch: websearchTool,
  kern: kernTool,
  message: messageTool,
  recall: recallTool,
  pdf: pdfTool,
  image: imageTool,
};

export type ToolName = keyof typeof allTools;
