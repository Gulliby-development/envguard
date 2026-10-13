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

function escapeMessage(value: string): string {
  return value.replace(/[%\r\n]/g, (character) => {
    if (character === "%") return "%25";
    return character === "\r" ? "%0D" : "%0A";
  });
}

function escapeFile(value: string): string {
  return value.replace(/[%\r\n:,]/g, (character) => {
    if (character === "%") return "%25";
    if (character === "\r") return "%0D";
    if (character === "\n") return "%0A";
    return character === ":" ? "%3A" : "%2C";
  });
}

export function formatGithub(report: Report, envPath: string, examplePath: string): string {
  const file = escapeFile(envPath);
  const escapedExample = escapeMessage(examplePath);
  const lines = [
    ...report.missing.map(
      (key) =>
        `::error file=${file},title=envguard::Missing key ${key} (required by ${escapedExample})`,
    ),
    ...report.empty.map((key) => `::error file=${file},title=envguard::Empty value for key ${key}`),
    ...report.extra.map(
      (key) =>
        `::${report.strict ? "error" : "warning"} file=${file},title=envguard::Extra key ${key} (not in ${escapedExample})`,
    ),
  ];
  return lines.join("\n");
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
