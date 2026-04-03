const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const COLORS: Record<string, string> = {
  kern: "\x1b[1m",      // bold white
  queue: "\x1b[33m",    // yellow
  runtime: "\x1b[36m",  // cyan
  telegram: "\x1b[34m", // blue
  slack: "\x1b[35m",    // magenta
  server: "\x1b[32m",   // green
  config: "\x1b[33m",   // yellow
  context: "\x1b[36m",  // cyan
  notes: "\x1b[32m",    // green
  recall: "\x1b[35m",   // magenta
  segments: "\x1b[34m", // blue
  memory: "\x1b[34m",   // blue
};
const RESET = "\x1b[0m";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: dim("DBG"),
  info: "",
  warn: "\x1b[33mWRN\x1b[0m",
  error: "\x1b[31mERR\x1b[0m",
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function write(component: string, message: string, level: LogLevel) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const time = new Date().toISOString();
  const color = COLORS[component] || "";
  const label = LEVEL_LABELS[level];
  const prefix = label ? `${label} ` : "";
  process.stderr.write(`${dim(time)} ${prefix}${color}[${component}]${RESET} ${message}\n`);
}

export function log(component: string, message: string) {
  write(component, message, "info");
}

log.debug = (component: string, message: string) => write(component, message, "debug");
log.warn = (component: string, message: string) => write(component, message, "warn");
log.error = (component: string, message: string) => write(component, message, "error");
