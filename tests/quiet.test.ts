import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport, formatHuman } from "../src/format";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const success = "Success: required environment keys are present and non-empty.";

describe("quiet mode", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-quiet-")));
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
    ["a passing check prints nothing", "A=1\n", "A=\n", ["--quiet"], 0, ""],
    ["the short flag works", "A=1\n", "A=\n", ["-q"], 0, ""],
    ["without the flag the success line stays", "A=1\n", "A=\n", [], 0, `${success}\n`],
    [
      "extra keys are still reported as warnings",
      "A=1\nB=2\n",
      "A=\n",
      ["--quiet"],
      0,
      "Extra keys (warnings): B\n",
    ],
    [
      "a failing check keeps its report",
      "A=1\n",
      "A=\nB=\n",
      ["-q"],
      1,
      "Environment problems found.\nMissing keys (errors): B\n",
    ],
    [
      "strict mode keeps extra keys as errors",
      "A=1\nB=2\n",
      "A=\n",
      ["--quiet", "--strict"],
      1,
      "Environment problems found.\nExtra keys (errors): B\n",
    ],
    [
      "duplicate keys are still reported",
      "A=1\nA=2\n",
      "A=\n",
      ["--quiet", "--duplicates"],
      0,
      "Duplicate keys (warnings): A\n",
    ],
    [
      "a passing check with an allowed empty key",
      "A=\n",
      "A=\n",
      ["-q", "--allow-empty", "A"],
      0,
      "",
    ],
    [
      "github annotations are unchanged",
      "A=1\nB=2\n",
      "A=\n",
      ["--quiet", "--github"],
      0,
      "::warning file=.env,title=envguard::Extra key B (not in .env.example)\n",
    ],
    ["github output of a passing check stays empty", "A=1\n", "A=\n", ["-q", "--github"], 0, ""],
  ];

  test.each(rows)("%s", (_name, env, example, args, status, stdout) => {
    const result = run(env, example, args);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(status);
    expect(result.stdout).toBe(stdout);
  });

  test.each([["--quiet"], ["-q"]])("%s with --json is a usage error", (flag) => {
    const result = run("A=1\n", "A=\n", [flag ?? "", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("envguard: --json and --quiet cannot be used together\n");
  });

  test("a value after the flag is rejected like any positional argument", () => {
    const result = run("A=1\n", "A=\n", ["--quiet", "yes"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().length).toBeGreaterThan(0);
  });

  test("formatHuman leaves out only the success line", () => {
    const passing = createReport({ missing: [], extra: ["B"], empty: [] }, "e", "x");
    expect(formatHuman(passing, true)).toBe("Extra keys (warnings): B");
    expect(formatHuman(passing)).toBe(`${success}\nExtra keys (warnings): B`);
    const clean = createReport({ missing: [], extra: [], empty: [] }, "e", "x");
    expect(formatHuman(clean, true)).toBe("");
    const failing = createReport({ missing: ["B"], extra: [], empty: [] }, "e", "x");
    expect(formatHuman(failing, true)).toBe(formatHuman(failing));
  });
});
