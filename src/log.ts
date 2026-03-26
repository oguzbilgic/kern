const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function log(component: string, message: string) {
  const time = new Date().toISOString();
  process.stderr.write(`${dim(time)} [${component}] ${message}\n`);
}
