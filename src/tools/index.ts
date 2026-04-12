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

const isWindows = process.platform === "win32";

export const allTools = {
  // bash is provided by the exec plugin (src/plugins/exec/).
  // On Windows, pwsh is still registered here as a core tool.
  ...(isWindows ? { pwsh: pwshTool } : {}),
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
  webfetch: webfetchTool,
  websearch: websearchTool,
  kern: kernTool,
  message: messageTool,
};

export type ToolName = keyof typeof allTools;
