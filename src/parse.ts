/**
 * Parse single-line dotenv assignments. Values remain literal: no interpolation
 * or command substitution is performed. Invalid lines are ignored.
 */
export function parseEnv(text: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, raw] = match;
    const value = parseValue(raw);
    if (value !== undefined) entries.set(key, value);
  }

  return entries;
}

function parseValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") {
    // A hash is a comment only when preceded by whitespace.
    return raw.replace(/\s+#.*$/, "").trim();
  }

  for (let index = 1; index < trimmed.length; index++) {
    if (trimmed[index] === "\\") {
      index++;
      continue;
    }
    if (trimmed[index] !== quote) continue;
    const suffix = trimmed.slice(index + 1).trim();
    if (suffix !== "" && !suffix.startsWith("#")) return undefined;
    return trimmed.slice(1, index);
  }

  // Unterminated quotes and multi-line values are not supported.
  return undefined;
}
