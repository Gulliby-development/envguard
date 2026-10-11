import type { Comparison } from "./compare";

export interface Report extends Comparison {
  ok: boolean;
  strict: boolean;
  env: string;
  example: string;
}

/** Copy and sort the lists so report creation never mutates its input. */
export function createReport(
  comparison: Comparison,
  env: string,
  example: string,
  strict = false,
): Report {
  const { missing, extra, empty } = comparison;
  return {
    ok: missing.length === 0 && empty.length === 0 && (!strict || extra.length === 0),
    strict,
    env,
    example,
    missing: [...missing].sort(),
    extra: [...extra].sort(),
    empty: [...empty].sort(),
  };
}

export function formatJson(report: Report): string {
  return JSON.stringify(report);
}

/** Reports expose key names, never environment values. */
export function formatHuman(report: Report): string {
  const lines = [
    report.ok
      ? "Success: required environment keys are present and non-empty."
      : "Environment problems found.",
  ];
  if (report.missing.length > 0) {
    lines.push(`Missing keys (errors): ${report.missing.join(", ")}`);
  }
  if (report.empty.length > 0) {
    lines.push(`Empty values (errors): ${report.empty.join(", ")}`);
  }
  if (report.extra.length > 0) {
    lines.push(`Extra keys (${report.strict ? "errors" : "warnings"}): ${report.extra.join(", ")}`);
  }
  return lines.join("\n");
}
