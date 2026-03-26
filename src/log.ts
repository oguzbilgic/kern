const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const COLORS: Record<string, string> = {
  kern: "\x1b[1m",      // bold white
  queue: "\x1b[33m",    // yellow
  runtime: "\x1b[36m",  // cyan
  telegram: "\x1b[34m", // blue
  slack: "\x1b[35m",    // magenta
  server: "\x1b[32m",   // green
};
const RESET = "\x1b[0m";

export function log(component: string, message: string) {
  const time = new Date().toISOString();
  const color = COLORS[component] || "";
  process.stderr.write(`${dim(time)} ${color}[${component}]${RESET} ${message}\n`);
}
