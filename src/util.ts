import TurndownService from "turndown";

/**
 * Extract plain text from message content (string or array).
 * Used for embeddings, search, summaries — strips media parts.
 */
export function extractText(content: string | any[] | any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");
  }
  return String(content ?? "");
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

turndown.remove(["script", "style", "noscript", "iframe"]);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

/**
 * Substitute ${VAR} references with values from process.env.
 * Read-only — never writes resolved values back. Matches OpenClaw's pattern.
 * Missing vars are left as literal `${VAR}` and logged (caller decides log policy).
 *
 * Variable names follow shell convention: letters, digits, underscore; first
 * char must not be a digit. Case-sensitive (matches process.env key lookup).
 */
export function substituteEnv(
  value: string,
  onMissing?: (name: string) => void,
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    const v = process.env[name];
    if (v === undefined) {
      onMissing?.(name);
      return match;
    }
    return v;
  });
}

/**
 * Recursively apply substituteEnv to all string values in an object.
 * Non-strings pass through unchanged. Arrays and nested objects are walked.
 */
export function substituteEnvDeep<T>(
  value: T,
  onMissing?: (name: string) => void,
): T {
  if (typeof value === "string") {
    return substituteEnv(value, onMissing) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteEnvDeep(v, onMissing)) as T;
  }
  // Only traverse plain objects. Non-plain objects (Date, Map, class instances)
  // would lose prototype/state if rebuilt via Object.entries, so pass them through.
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteEnvDeep(v, onMissing);
    }
    return out as T;
  }
  return value;
}
