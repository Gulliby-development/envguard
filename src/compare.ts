export interface Comparison {
  missing: string[];
  extra: string[];
  empty: string[];
}

/** Compare keys, checking empty values only for required keys. */
export function compareEnv(
  env: ReadonlyMap<string, string>,
  example: ReadonlyMap<string, string>,
): Comparison {
  const missing: string[] = [];
  const extra: string[] = [];
  const empty: string[] = [];

  for (const key of example.keys()) {
    if (!env.has(key)) {
      missing.push(key);
    } else if (env.get(key)?.trim() === "") {
      empty.push(key);
    }
  }
  for (const key of env.keys()) {
    if (!example.has(key)) extra.push(key);
  }

  return { missing: missing.sort(), extra: extra.sort(), empty: empty.sort() };
}
