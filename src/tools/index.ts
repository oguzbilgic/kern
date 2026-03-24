import { bashTool } from "./bash.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";

export const allTools = {
  bash: bashTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
};

export type ToolName = keyof typeof allTools;
