import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const manifest: { version: string } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("CLI", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-cli-")));
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
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBeNull();
    return result;
  }

  function expectUsageError(args: string[]): void {
    const result = runCli(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().length).toBeGreaterThan(0);
  }

  test("uses default files in cwd and succeeds without comparing their values", () => {
    writeDefaults("A=actual\nB=secret-value\n", "A=example\nB=\n");
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/ok|success|match|present/i);
    expect(result.stdout).not.toContain("\u001b");
    expect(result.stdout).not.toContain("secret-value");
  });

  test.each([
    ["missing", "A=1\n", "A=\nB=\n", "B"],
    ["empty", "A=\n", "A=example\n", "A"],
    ["empty", "A='  '\n", "A=example\n", "A"],
  ])("fails for %s required keys", (category, env, example, key) => {
    writeDefaults(env, example);
    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.toLowerCase()).toContain(category);
    expect(result.stdout).toContain(key);
    expect(result.stdout).not.toContain("\u001b");
  });

  test("warns about extra keys by default and treats them as errors with --strict", () => {
    writeDefaults("REQUIRED=1\nEXTRA=\n", "REQUIRED=\n");
    const normal = runCli();
    expect(normal.status).toBe(0);
    expect(normal.stderr).toBe("");
    expect(normal.stdout).toContain("EXTRA");
    expect(normal.stdout).toMatch(/warn/i);

    const strict = runCli(["--strict"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toBe("");
    expect(strict.stdout).toContain("EXTRA");
    expect(strict.stdout).toMatch(/error/i);
    expect(strict.stdout).not.toContain("\u001b");
  });

  test("prints exactly one JSON document with sorted categories and resolved paths", () => {
    writeDefaults(
      "Z_EXTRA=private-value\nB_EMPTY='  '\nA_EXTRA=2\nA_EMPTY=\nKEPT=1\n",
      "Z_MISSING=\nA_MISSING=\nB_EMPTY=default\nA_EMPTY=default\nKEPT=\n",
    );
    const result = runCli(["--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      strict: false,
      env: resolve(directory, ".env"),
      example: resolve(directory, ".env.example"),
      missing: ["A_MISSING", "Z_MISSING"],
      extra: ["A_EXTRA", "Z_EXTRA"],
      empty: ["A_EMPTY", "B_EMPTY"],
    });
    expect(result.stdout).not.toContain("private-value");
  });

  test.each([false, true])("JSON ok reflects the exit code with strict=%s", (strict) => {
    writeDefaults("A=1\nEXTRA=2\n", "A=\n");
    const result = runCli(strict ? ["--json", "--strict"] : ["--json"]);
    expect(result.status).toBe(strict ? 1 : 0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: !strict,
      strict,
      env: resolve(directory, ".env"),
      example: resolve(directory, ".env.example"),
      missing: [],
      extra: ["EXTRA"],
      empty: [],
    });
  });

  test("matching files have a successful strict JSON report", () => {
    writeDefaults("A=1\n", "A=\n");
    const result = runCli(["--json", "--strict"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      strict: true,
      env: resolve(directory, ".env"),
      example: resolve(directory, ".env.example"),
      missing: [],
      extra: [],
      empty: [],
    });
  });

  const invalidArguments = [
    ["--bogus"],
    ["--env"],
    ["--example"],
    ["--env", "--strict"],
    ["--example", "--strict"],
    ["positional.env"],
  ];

  for (const json of [false, true]) {
    test.each(invalidArguments.map((args) => [args]))(
      `rejects invalid arguments %j with json=${json}`,
      (args) => {
        writeDefaults("A=1\n", "A=\n");
        expectUsageError(json ? ["--json", ...args] : args);
      },
    );

    test.each([".env", ".env.example"])(`reports nonexistent %s with json=${json}`, (filename) => {
      writeDefaults("A=1\n", "A=\n");
      rmSync(join(directory, filename));
      expectUsageError(json ? ["--json"] : []);
    });

    test.each([".env", ".env.example"])(
      `reports unreadable directory input %s with json=${json}`,
      (filename) => {
        writeDefaults("A=1\n", "A=\n");
        rmSync(join(directory, filename));
        mkdirSync(join(directory, filename));
        expectUsageError(json ? ["--json"] : []);
      },
    );
  }

  test.each(["absolute", "relative"])(
    "uses custom %s paths from another cwd, including spaces",
    (kind) => {
      const inputDirectory = join(directory, "input files");
      const cwd = join(directory, "other cwd");
      mkdirSync(inputDirectory);
      mkdirSync(cwd);
      const envPath = join(inputDirectory, "custom env");
      const examplePath = join(inputDirectory, "custom example");
      writeFileSync(envPath, "CUSTOM=1\n");
      writeFileSync(examplePath, "CUSTOM=\n");
      // Deliberately incompatible defaults ensure the custom options are used.
      writeFileSync(join(cwd, ".env"), "");
      writeFileSync(join(cwd, ".env.example"), "WRONG=\n");
      const envArg = kind === "absolute" ? envPath : join("..", "input files", "custom env");
      const exampleArg =
        kind === "absolute" ? examplePath : join("..", "input files", "custom example");
      const result = runCli(["--env", envArg, "--example", exampleArg, "--json"], cwd);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        strict: false,
        env: envPath,
        example: examplePath,
        missing: [],
        extra: [],
        empty: [],
      });
    },
  );

  test.each(["--help", "-h"])(
    "%s works without env files and describes options and exits",
    (flag) => {
      const result = runCli([flag]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      for (const option of [
        "--env",
        "--example",
        "--strict",
        "--allow-empty <KEY>  Keys allowed to be empty; repeatable, comma-separated, KEY or PREFIX*",
        "--json",
        "--help",
        "--version",
      ]) {
        expect(result.stdout).toContain(option);
      }
      expect(result.stdout).toMatch(/exit codes/i);
      for (const code of [0, 1, 2]) {
        expect(result.stdout).toMatch(new RegExp(`^\\s*${code}\\s+`, "m"));
      }
    },
  );

  test.each(["--version", "-v"])("%s prints the package version without env files", (flag) => {
    const result = runCli([flag]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(manifest.version);
  });

  test("CRLF and LF files produce identical JSON reports and exit codes", () => {
    const envLines = ["export PRESENT=1", "EMPTY='  '", "EXTRA=2", ""];
    const exampleLines = ["PRESENT=", "EMPTY=", "MISSING=", ""];
    writeDefaults(envLines.join("\n"), exampleLines.join("\n"));
    const lf = runCli(["--json", "--strict"]);
    writeDefaults(envLines.join("\r\n"), exampleLines.join("\r\n"));
    const crlf = runCli(["--json", "--strict"]);
    expect(lf.status).toBe(1);
    expect(crlf.status).toBe(lf.status);
    expect(lf.stderr).toBe("");
    expect(crlf.stderr).toBe("");
    expect(JSON.parse(crlf.stdout)).toEqual(JSON.parse(lf.stdout));
    expect(JSON.parse(crlf.stdout)).toMatchObject({
      missing: ["MISSING"],
      extra: ["EXTRA"],
      empty: ["EMPTY"],
    });
  });

  test("allows exact keys and whitespace-only values without affecting non-empty values", () => {
    writeDefaults("A=   \nB=present\n", "A=required\nB=required\n");
    const result = runCli(["--allow-empty", "A", "--json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      strict: false,
      env: resolve(directory, ".env"),
      example: resolve(directory, ".env.example"),
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test("supports prefixes including the bare prefix, comma lists, repeats, and mixed forms", () => {
    writeDefaults(
      "FEATURE_=\nFEATURE_FLAG=\nA=\nB=\nC=\n",
      "FEATURE_=required\nFEATURE_FLAG=required\nA=required\nB=required\nC=required\n",
    );
    const result = runCli([
      "--allow-empty",
      "FEATURE_*, A",
      "--allow-empty=B",
      "--allow-empty",
      "C",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "Success: required environment keys are present and non-empty.",
    );
  });

  test("allowed keys remain missing and extra keys still fail in strict mode", () => {
    writeDefaults("EXTRA=\n", "MISSING=required\n");
    const missing = runCli(["--allow-empty", "MISSING", "--json"]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout)).toMatchObject({ missing: ["MISSING"], empty: [] });

    writeDefaults("EXTRA=\n", "");
    const extra = runCli(["--allow-empty", "EXTRA", "--strict", "--json"]);
    expect(extra.status).toBe(1);
    expect(JSON.parse(extra.stdout)).toMatchObject({ missing: [], extra: ["EXTRA"], empty: [] });
  });

  test("allows patterns that match nothing and preserves empty reporting without the option", () => {
    writeDefaults("A=\n", "A=required\n");
    const allowed = runCli(["--allow-empty", "NO_MATCH_*", "--json"]);
    expect(allowed.status).toBe(1);
    expect(JSON.parse(allowed.stdout)).toMatchObject({ empty: ["A"] });

    const unchanged = runCli(["--json"]);
    expect(unchanged.status).toBe(1);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({ empty: ["A"] });
  });

  test.each(["", "A,,B", "*", "A*B", "1BAD", "BAD-KEY", "A B"])(
    "rejects invalid --allow-empty value %j with the required diagnostic",
    (value) => {
      writeDefaults("A=1\n", "A=\n");
      const result = runCli(["--allow-empty", value, "--json"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "envguard: --allow-empty needs a key name or a prefix ending in *\n",
      );
    },
  );

  test("rejects an empty --allow-empty value using equals syntax", () => {
    writeDefaults("A=1\n", "A=\n");
    const result = runCli(["--allow-empty=", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "envguard: --allow-empty needs a key name or a prefix ending in *\n",
    );
  });

  test("uses parseArgs' existing error path when --allow-empty has no value", () => {
    writeDefaults("A=1\n", "A=\n");
    expectUsageError(["--allow-empty"]);
  });

  describe("--ignore-extra", () => {
    const successLine = "Success: required environment keys are present and non-empty.";
    const ignoreMessage = "envguard: --ignore-extra needs a key name or a prefix ending in *\n";

    beforeEach(() => {
      writeDefaults("A=1\nCI=true\nCI_JOB_ID=42\nTZ=UTC\n", "A=\n");
    });

    test("reports all extras as warnings without the option", () => {
      const result = runCli();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${successLine}\nExtra keys (warnings): CI, CI_JOB_ID, TZ\n`);
    });

    test("reports all extras as errors with --strict", () => {
      const result = runCli(["--strict"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        "Environment problems found.\nExtra keys (errors): CI, CI_JOB_ID, TZ\n",
      );
    });

    test("ignoring all extras makes --strict succeed", () => {
      const result = runCli(["--strict", "--ignore-extra", "CI*,TZ"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${successLine}\n`);
    });

    test("an exact key does not match other keys sharing its prefix", () => {
      const result = runCli(["--ignore-extra", "CI"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${successLine}\nExtra keys (warnings): CI_JOB_ID, TZ\n`);
    });

    test("JSON output omits ignored extras", () => {
      const result = runCli(["--json", "--ignore-extra", "CI", "--ignore-extra", "TZ"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout);
      expect(report.extra).toEqual(["CI_JOB_ID"]);
      expect(report.ok).toBe(true);
    });

    test.each([
      [["--ignore-extra", "CI", "--ignore-extra", "TZ"]],
      [["--ignore-extra", "CI,TZ"]],
      [["--ignore-extra", " CI , TZ "]],
      [["--ignore-extra=CI", "--ignore-extra=TZ"]],
      [["--ignore-extra=CI,TZ"]],
    ])("equivalent form %j gives the same result", (args) => {
      const result = runCli(args);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${successLine}\nExtra keys (warnings): CI_JOB_ID\n`);
    });

    test.each(["bad key", "1A", "A,,B", ""])("rejects invalid value %j", (value) => {
      const result = runCli(["--ignore-extra", value]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(ignoreMessage);
    });

    test("rejects an empty value using equals syntax", () => {
      const result = runCli(["--ignore-extra="]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(ignoreMessage);
    });

    test("validates before --help", () => {
      const result = runCli(["--ignore-extra", "bad key", "--help"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(ignoreMessage);
    });

    test("the --allow-empty message wins when both options are invalid", () => {
      const result = runCli(["--ignore-extra", "bad key", "--allow-empty", "1A"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "envguard: --allow-empty needs a key name or a prefix ending in *\n",
      );
    });

    test("uses parseArgs' existing error path when the option has no value", () => {
      expectUsageError(["--ignore-extra"]);
    });

    test("help lists the option", () => {
      const result = runCli(["--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--ignore-extra <KEY>");
    });
  });
});
