export interface Comparison {
  missing: string[];
  extra: string[];
  empty: string[];
}

function matchesKey(key: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
  );
}

/** Compare keys, checking empty values only for required keys. */
export function compareEnv(
  env: ReadonlyMap<string, string>,
  example: ReadonlyMap<string, string>,
  allowEmpty: readonly string[] = [],
  ignoreExtra: readonly string[] = [],
): Comparison {
  const missing: string[] = [];
  const extra: string[] = [];
  const empty: string[] = [];

  for (const key of example.keys()) {
    if (!env.has(key)) {
      missing.push(key);
    } else if (env.get(key)?.trim() === "" && !matchesKey(key, allowEmpty)) {
      empty.push(key);
    }
  }
  for (const key of env.keys()) {
    if (!example.has(key) && !matchesKey(key, ignoreExtra)) extra.push(key);
  }

  return { missing: missing.sort(), extra: extra.sort(), empty: empty.sort() };
}
