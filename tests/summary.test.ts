import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport, formatHuman, formatSummary } from "../src/format";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const success = "Success: required environment keys are present and non-empty.";

describe("summary line", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-summary-")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function run(env: string, example: string, args: string[]) {
    writeFileSync(join(directory, ".env"), env, "utf8");
    writeFileSync(join(directory, ".env.example"), example, "utf8");
    const result = spawnSync(process.execPath, ["run", cliPath, ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  const rows: [string, string, string, string[], number, string][] = [
    [
      "a passing check gets the success line and the summary",
      "A=1\n",
      "A=\n",
      ["--summary"],
      0,
      `${success}\nSummary: 0 missing, 0 empty, 0 extra\n`,
    ],
    ["without the flag nothing changes", "A=1\n", "A=\n", [], 0, `${success}\n`],
    [
      "every list is counted",
      "A=1\nC=\nD=4\nE=5\n",
      "A=\nB=\nC=\n",
      ["--summary"],
      1,
      "Environment problems found.\nMissing keys (errors): B\nEmpty values (errors): C\nExtra keys (warnings): D, E\nSummary: 1 missing, 1 empty, 2 extra\n",
    ],
    [
      "quiet leaves out only the success line",
      "A=1\n",
      "A=\n",
      ["--summary", "--quiet"],
      0,
      "Summary: 0 missing, 0 empty, 0 extra\n",
    ],
    [
      "ignored extra keys are not counted",
      "A=1\nCI=true\nTZ=UTC\n",
      "A=\n",
      ["--summary", "--ignore-extra", "CI*"],
      0,
      `${success}\nExtra keys (warnings): TZ\nSummary: 0 missing, 0 empty, 1 extra\n`,
    ],
    [
      "an allowed empty key is not counted",
      "A=\n",
      "A=\n",
      ["--summary", "--allow-empty", "A"],
      0,
      `${success}\nSummary: 0 missing, 0 empty, 0 extra\n`,
    ],
    [
      "duplicates add a fourth count",
      "A=1\nA=2\n",
      "A=\n",
      ["--summary", "--duplicates"],
      0,
      `${success}\nDuplicate keys (warnings): A\nSummary: 0 missing, 0 empty, 0 extra, 1 duplicate\n`,
    ],
    [
      "duplicates checked and none found count zero",
      "A=1\n",
      "A=\n",
      ["--duplicates", "--summary"],
      0,
      `${success}\nSummary: 0 missing, 0 empty, 0 extra, 0 duplicate\n`,
    ],
    [
      "strict mode keeps the counts and the exit code",
      "A=1\nB=2\n",
      "A=\n",
      ["--summary", "--strict"],
      1,
      "Environment problems found.\nExtra keys (errors): B\nSummary: 0 missing, 0 empty, 1 extra\n",
    ],
  ];

  test.each(rows)("%s", (_name, env, example, args, status, stdout) => {
    const result = run(env, example, args);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(status);
    expect(result.stdout).toBe(stdout);
  });

  test.each([
    ["--json", "--summary and --json cannot be used together"],
    ["--github", "--summary and --github cannot be used together"],
  ])("%s with --summary is a usage error", (flag, message) => {
    const result = run("A=1\n", "A=\n", ["--summary", flag ?? ""]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`envguard: ${message}\n`);
  });

  test("the summary never shows a value", () => {
    const result = run("A=secret-one\nB=secret-two\n", "A=\n", ["--summary"]);
    expect(result.stdout).not.toContain("secret");
  });

  test("formatSummary counts the lists of a report", () => {
    const report = createReport({ missing: ["B"], extra: ["D", "E"], empty: [] }, "e", "x");
    expect(formatSummary(report)).toBe("Summary: 1 missing, 0 empty, 2 extra");
    const checked = createReport({ missing: [], extra: [], empty: [] }, "e", "x", false, ["A"]);
    expect(formatSummary(checked)).toBe("Summary: 0 missing, 0 empty, 0 extra, 1 duplicate");
  });

  test("formatHuman adds the summary last and only when asked", () => {
    const report = createReport({ missing: [], extra: ["B"], empty: [] }, "e", "x");
    expect(formatHuman(report, false, true)).toBe(
      `${success}\nExtra keys (warnings): B\nSummary: 0 missing, 0 empty, 1 extra`,
    );
    expect(formatHuman(report)).toBe(`${success}\nExtra keys (warnings): B`);
    expect(formatHuman(report, true, true)).toBe(
      "Extra keys (warnings): B\nSummary: 0 missing, 0 empty, 1 extra",
    );
  });
});
