import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport, formatGithub, formatHuman } from "../src/format";
import { findDuplicateKeys, parseEnv } from "../src/parse";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const successLine = "Success: required environment keys are present and non-empty.";

describe("duplicate assignment reporting", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-duplicates-")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function writeDefaults(env: string, example: string): void {
    writeFileSync(join(directory, ".env"), env, "utf8");
    writeFileSync(join(directory, ".env.example"), example, "utf8");
  }

  function runCli(args: string[] = [], cwd = directory) {
    const result = spawnSync(process.execPath, ["run", cliPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBeNull();
    return result;
  }

  function jsonLine(value: object): string {
    return [JSON.stringify(value) ?? "", ""].join("\n");
  }

  test("findDuplicateKeys follows accepted assignment parsing and preserves last-value-wins", () => {
    const text = [
      "B=first",
      "A=first",
      "B=second",
      "export A='last value'",
      "A=third",
      "a=lowercase",
      "EMPTY=",
      "EMPTY=''",
      "DOUBLE=one",
      'DOUBLE="two"',
      "BAD=accepted",
      'BAD="unterminated',
      "SUFFIX=accepted",
      'SUFFIX="closed" trailing',
      "not an assignment",
      "# KEY=comment",
    ].join("\n");

    expect(findDuplicateKeys(text)).toEqual(["A", "B", "DOUBLE", "EMPTY"]);
    expect(parseEnv(text).get("A")).toBe("third");
    expect(parseEnv(text).get("B")).toBe("second");
    expect(parseEnv(text).get("BAD")).toBe("accepted");
    expect(parseEnv(text).get("SUFFIX")).toBe("accepted");
  });

  test("findDuplicateKeys sorts unique keys, handles BOM and CRLF, and ignores rejected lines", () => {
    expect(findDuplicateKeys("\uFEFFA=first\r\nB=first\r\nA=second\r\nB=second\r\n")).toEqual([
      "A",
      "B",
    ]);
    expect(findDuplicateKeys("")).toEqual([]);
    expect(findDuplicateKeys('# A=1\ninvalid line\nA="unterminated\n')).toEqual([]);
  });

  test("createReport omits an unspecified duplicate field and retains the existing failure rules", () => {
    const report = createReport(
      { missing: [], extra: [], empty: ["EMPTY"] },
      ".env",
      ".env.example",
    );

    expect(Object.hasOwn(report, "duplicate")).toBe(false);
    expect(report.ok).toBe(false);
    expect(formatHuman(report)).toBe("Environment problems found.\nEmpty values (errors): EMPTY");
  });

  test("createReport copies and sorts duplicate keys without mutating its input", () => {
    const input = ["B", "A"];
    const report = createReport(
      { missing: [], extra: [], empty: [] },
      ".env",
      ".env.example",
      false,
      input,
    );

    expect(report.duplicate).toEqual(["A", "B"]);
    expect(report.duplicate).not.toBe(input);
    expect(input).toEqual(["B", "A"]);
    expect(report.ok).toBe(true);
  });

  test("an explicitly empty duplicate list stays present but does not fail strict reports", () => {
    const report = createReport(
      { missing: [], extra: [], empty: [] },
      ".env",
      ".env.example",
      true,
      [],
    );

    expect(Object.hasOwn(report, "duplicate")).toBe(true);
    expect(report.duplicate).toEqual([]);
    expect(report.ok).toBe(true);
    expect(formatHuman(report)).toBe(successLine);
    expect(formatGithub(report, ".env", ".env.example")).toBe("");
  });

  test("strict reports treat duplicate-only findings as errors", () => {
    const comparison = { missing: [], extra: [], empty: [] };
    const warning = createReport(comparison, ".env", ".env.example", false, ["A"]);
    const error = createReport(comparison, ".env", ".env.example", true, ["A"]);

    expect(warning.ok).toBe(true);
    expect(formatHuman(warning)).toBe([successLine, "Duplicate keys (warnings): A"].join("\n"));
    expect(error.ok).toBe(false);
    expect(formatHuman(error)).toBe(
      ["Environment problems found.", "Duplicate keys (errors): A"].join("\n"),
    );
  });

  test("human output matches the worked example, including strict and ignored-extra behavior", () => {
    writeDefaults("A=1\nB=2\nA=3\nCI=true\nC=\nCI=false\nexport A=4\n", "A=\nB=\nC=\n");

    const warning = runCli(["--duplicates"]);
    expect(warning.status).toBe(1);
    expect(warning.stderr).toBe("");
    expect(warning.stdout).toBe(
      [
        "Environment problems found.",
        "Empty values (errors): C",
        "Extra keys (warnings): CI",
        "Duplicate keys (warnings): A, CI",
        "",
      ].join("\n"),
    );

    const strict = runCli(["--duplicates", "--strict"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toBe("");
    expect(strict.stdout).toBe(
      [
        "Environment problems found.",
        "Empty values (errors): C",
        "Extra keys (errors): CI",
        "Duplicate keys (errors): A, CI",
        "",
      ].join("\n"),
    );

    const ignored = runCli(["--duplicates", "--ignore-extra", "CI"]);
    expect(ignored.status).toBe(1);
    expect(ignored.stderr).toBe("");
    expect(ignored.stdout).toBe(
      [
        "Environment problems found.",
        "Empty values (errors): C",
        "Duplicate keys (warnings): A, CI",
        "",
      ].join("\n"),
    );
  });

  test("human output keeps duplicates as warnings until strict and omits an empty duplicate line", () => {
    writeDefaults("A=1\nB=2\nA=3\n", "A=\n");

    const normal = runCli(["--duplicates"]);
    expect(normal.status).toBe(0);
    expect(normal.stderr).toBe("");
    expect(normal.stdout).toBe(
      [successLine, "Extra keys (warnings): B", "Duplicate keys (warnings): A", ""].join("\n"),
    );

    const strict = runCli(["--strict", "--duplicates"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toBe("");
    expect(strict.stdout).toBe(
      [
        "Environment problems found.",
        "Extra keys (errors): B",
        "Duplicate keys (errors): A",
        "",
      ].join("\n"),
    );

    writeDefaults("A=1\n", "A=\n");
    const noDuplicates = runCli(["--duplicates"]);
    expect(noDuplicates.status).toBe(0);
    expect(noDuplicates.stdout).toBe([successLine, ""].join("\n"));
  });

  test("JSON puts duplicate last when enabled and preserves default output when disabled", () => {
    writeDefaults("A=1\nB=2\nA=3\nCI=true\nC=\nCI=false\nexport A=4\n", "A=\nB=\nC=\n");

    const enabled = runCli(["--duplicates", "--json"]);
    expect(enabled.status).toBe(1);
    expect(enabled.stderr).toBe("");
    expect(enabled.stdout).toBe(
      jsonLine({
        ok: false,
        strict: false,
        env: resolve(directory, ".env"),
        example: resolve(directory, ".env.example"),
        missing: [],
        extra: ["CI"],
        empty: ["C"],
        duplicate: ["A", "CI"],
      }),
    );
    expect(enabled.stdout.endsWith('"empty":["C"],"duplicate":["A","CI"]}\n')).toBe(true);
    expect(enabled.stdout).not.toContain("CI=true");
    expect(enabled.stdout).not.toContain("CI=false");

    const disabled = runCli(["--json"]);
    expect(disabled.status).toBe(1);
    expect(disabled.stderr).toBe("");
    expect(disabled.stdout).toBe(
      jsonLine({
        ok: false,
        strict: false,
        env: resolve(directory, ".env"),
        example: resolve(directory, ".env.example"),
        missing: [],
        extra: ["CI"],
        empty: ["C"],
      }),
    );
    expect(JSON.parse(disabled.stdout)).not.toHaveProperty("duplicate");
  });

  test("JSON includes an empty duplicate field and strict duplicate-only reports fail", () => {
    writeDefaults("A=1\n", "A=\n");

    const empty = runCli(["--json", "--duplicates"]);
    expect(empty.status).toBe(0);
    expect(empty.stderr).toBe("");
    expect(empty.stdout).toBe(
      jsonLine({
        ok: true,
        strict: false,
        env: resolve(directory, ".env"),
        example: resolve(directory, ".env.example"),
        missing: [],
        extra: [],
        empty: [],
        duplicate: [],
      }),
    );

    writeDefaults("A=1\nA=2\n", "A=\n");
    const warning = runCli(["--duplicates", "--json"]);
    expect(warning.status).toBe(0);
    expect(JSON.parse(warning.stdout)).toMatchObject({ ok: true, duplicate: ["A"] });

    const strict = runCli(["--duplicates", "--strict", "--json"]);
    expect(strict.status).toBe(1);
    expect(JSON.parse(strict.stdout)).toMatchObject({ ok: false, strict: true, duplicate: ["A"] });
    expect(strict.stdout).not.toContain("A=1");
    expect(strict.stdout).not.toContain("A=2");
  });

  test("GitHub output matches the worked annotations and promotes warnings in strict mode", () => {
    writeDefaults("A=1\nB=2\nA=3\nCI=true\nC=\nCI=false\nexport A=4\n", "A=\nB=\nC=\n");

    const warning = runCli(["--duplicates", "--github"]);
    expect(warning.status).toBe(1);
    expect(warning.stderr).toBe("");
    expect(warning.stdout).toBe(
      [
        "::error file=.env,title=envguard::Empty value for key C",
        "::warning file=.env,title=envguard::Extra key CI (not in .env.example)",
        "::warning file=.env,title=envguard::Duplicate key A (assigned more than once)",
        "::warning file=.env,title=envguard::Duplicate key CI (assigned more than once)",
        "",
      ].join("\n"),
    );

    const strict = runCli(["--github", "--strict", "--duplicates"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toBe("");
    expect(strict.stdout).toBe(
      [
        "::error file=.env,title=envguard::Empty value for key C",
        "::error file=.env,title=envguard::Extra key CI (not in .env.example)",
        "::error file=.env,title=envguard::Duplicate key A (assigned more than once)",
        "::error file=.env,title=envguard::Duplicate key CI (assigned more than once)",
        "",
      ].join("\n"),
    );
    expect(strict.stdout).not.toContain("CI=true");
  });

  test("allow-empty and ignore-extra do not suppress duplicates, regardless of flag position", () => {
    writeDefaults("A=1\nA=2\nC=\nC=\nEXTRA=first\nEXTRA=second\n", "A=\nC=required\n");
    const expected = [successLine, "Duplicate keys (warnings): A, C, EXTRA", ""].join("\n");

    const before = runCli(["--duplicates", "--allow-empty", "C", "--ignore-extra", "EXTRA"]);
    expect(before.status).toBe(0);
    expect(before.stderr).toBe("");
    expect(before.stdout).toBe(expected);

    const after = runCli(["--allow-empty", "C", "--ignore-extra", "EXTRA", "--duplicates"]);
    expect(after.status).toBe(0);
    expect(after.stderr).toBe("");
    expect(after.stdout).toBe(expected);
  });

  test("custom env and example paths select the env file and never inspect template duplicates", () => {
    const inputDirectory = join(directory, "custom inputs");
    mkdirSync(inputDirectory);
    const envPath = join(inputDirectory, "custom env");
    const examplePath = join(inputDirectory, "custom example");
    writeFileSync(join(directory, ".env"), "DEFAULT=once\n", "utf8");
    writeFileSync(join(directory, ".env.example"), "DEFAULT=\n", "utf8");
    writeFileSync(envPath, "A=1\nA=2\nTEMPLATE_ONLY=once\n", "utf8");
    writeFileSync(examplePath, "A=\nTEMPLATE_ONLY=one\nTEMPLATE_ONLY=two\n", "utf8");

    const result = runCli(["--env", envPath, "--duplicates", "--example", examplePath, "--json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      jsonLine({
        ok: true,
        strict: false,
        env: realpathSync(envPath),
        example: realpathSync(examplePath),
        missing: [],
        extra: [],
        empty: [],
        duplicate: ["A"],
      }),
    );
  });

  test("all default formats remain unchanged when the option is absent", () => {
    writeDefaults("A=1\nEXTRA=private-first\nEXTRA=private-second\n", "A=\n");

    const human = runCli();
    expect(human.status).toBe(0);
    expect(human.stdout).toBe([successLine, "Extra keys (warnings): EXTRA", ""].join("\n"));

    const json = runCli(["--json"]);
    expect(json.status).toBe(0);
    expect(json.stdout).toBe(
      jsonLine({
        ok: true,
        strict: false,
        env: resolve(directory, ".env"),
        example: resolve(directory, ".env.example"),
        missing: [],
        extra: ["EXTRA"],
        empty: [],
      }),
    );
    expect(JSON.parse(json.stdout)).not.toHaveProperty("duplicate");

    const github = runCli(["--github"]);
    expect(github.status).toBe(0);
    expect(github.stdout).toBe(
      "::warning file=.env,title=envguard::Extra key EXTRA (not in .env.example)\n",
    );
    for (const output of [human.stdout, json.stdout, github.stdout]) {
      expect(output).not.toContain("private-first");
      expect(output).not.toContain("private-second");
    }
  });

  test("GitHub duplicate annotations use the existing file escaping", () => {
    const report = createReport(
      { missing: [], extra: [], empty: [] },
      ".env",
      ".env.example",
      false,
      ["A"],
    );

    expect(formatGithub(report, ".env%,\r\n:part", ".env.example")).toBe(
      "::warning file=.env%25%2C%0D%0A%3Apart,title=envguard::Duplicate key A (assigned more than once)",
    );
  });

  test("invalid arguments and mutually exclusive formats remain usage errors with duplicates enabled", () => {
    writeDefaults("A=1\nA=2\n", "A=\n");

    const invalid = runCli(["--duplicates=invalid"]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr.trim().length).toBeGreaterThan(0);

    const positional = runCli(["--duplicates", "unexpected"]);
    expect(positional.status).toBe(2);
    expect(positional.stdout).toBe("");
    expect(positional.stderr.trim().length).toBeGreaterThan(0);

    const incompatible = runCli(["--duplicates", "--json", "--github"]);
    expect(incompatible.status).toBe(2);
    expect(incompatible.stdout).toBe("");
    expect(incompatible.stderr).toBe("envguard: --json and --github cannot be used together\n");
  });

  test("help lists the exact duplicates option immediately before JSON", () => {
    for (const flag of ["--help", "-h"]) {
      const result = runCli([flag]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const lines = result.stdout.split(/\r?\n/);
      const duplicateIndex = lines.indexOf(
        "  --duplicates      Report keys assigned more than once in the env file",
      );
      expect(duplicateIndex).toBeGreaterThanOrEqual(0);
      expect(lines[duplicateIndex + 1]).toBe("  --json            Print one JSON report");
    }
  });

  test("GitHub annotations stay empty when duplicate reporting finds no duplicate", () => {
    writeDefaults("A=1\n", "A=\n");
    const result = runCli(["--duplicates", "--github"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
});
