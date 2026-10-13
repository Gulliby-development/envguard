import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport, formatGithub } from "../src/format";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const readmePath = new URL("../README.md", import.meta.url);

describe("GitHub annotations", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-github-")));
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

  test("formats sorted missing, empty, and extra annotations without a trailing LF", () => {
    const report = createReport(
      {
        missing: ["Z_MISSING", "A_MISSING"],
        empty: ["Z_EMPTY", "A_EMPTY"],
        extra: ["Z_EXTRA", "A_EXTRA"],
      },
      ".env",
      ".env.example",
    );

    expect(formatGithub(report, ".env", ".env.example")).toBe(
      [
        "::error file=.env,title=envguard::Missing key A_MISSING (required by .env.example)",
        "::error file=.env,title=envguard::Missing key Z_MISSING (required by .env.example)",
        "::error file=.env,title=envguard::Empty value for key A_EMPTY",
        "::error file=.env,title=envguard::Empty value for key Z_EMPTY",
        "::warning file=.env,title=envguard::Extra key A_EXTRA (not in .env.example)",
        "::warning file=.env,title=envguard::Extra key Z_EXTRA (not in .env.example)",
      ].join("\n"),
    );
    expect(
      formatGithub(
        createReport({ missing: [], empty: [], extra: [] }, ".env", ".env.example"),
        ".env",
        ".env.example",
      ),
    ).toBe("");
  });

  test("prints the three annotation categories in order and never prints values", () => {
    writeDefaults("A=1\nC=\nCI=true\nSECRET=hunter2\n", "A=\nB=\nC=\nSECRET=\n");

    const result = runCli(["--github"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "::error file=.env,title=envguard::Missing key B (required by .env.example)",
        "::error file=.env,title=envguard::Empty value for key C",
        "::warning file=.env,title=envguard::Extra key CI (not in .env.example)",
        "",
      ].join("\n"),
    );
    expect(result.stdout).not.toContain("hunter2");
    expect(result.stdout).not.toContain("\u001b");
  });

  test("uses errors for strict extras and warnings alone still exit successfully", () => {
    writeDefaults("A=1\nEXTRA=2\n", "A=\n");
    const warning = runCli(["--github"]);

    expect(warning.status).toBe(0);
    expect(warning.stderr).toBe("");
    expect(warning.stdout).toBe(
      "::warning file=.env,title=envguard::Extra key EXTRA (not in .env.example)\n",
    );

    const strict = runCli(["--github", "--strict"]);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toBe("");
    expect(strict.stdout).toBe(
      "::error file=.env,title=envguard::Extra key EXTRA (not in .env.example)\n",
    );
  });

  test("writes nothing for clean and ignored-extra reports", () => {
    writeDefaults("A=1\n", "A=\n");
    const clean = runCli(["--github"]);
    expect(clean.status).toBe(0);
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toBe("");

    writeDefaults("A=1\nCI=true\n", "A=\n");
    const ignored = runCli(["--github", "--ignore-extra", "CI"]);
    expect(ignored.status).toBe(0);
    expect(ignored.stderr).toBe("");
    expect(ignored.stdout).toBe("");
  });

  test("--allow-empty keys are not annotated", () => {
    writeDefaults("A=\n", "A=required\n");

    const result = runCli(["--github", "--allow-empty", "A"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  test("escapes comma and percent in the command-line paths without resolving them", () => {
    const envPath = join("a,b", "local.env");
    const examplePath = "100%.example";
    mkdirSync(join(directory, "a,b"));
    writeFileSync(join(directory, envPath), "", "utf8");
    writeFileSync(join(directory, examplePath), "MISSING=required\n", "utf8");

    const result = runCli(["--github", "--env", envPath, "--example", examplePath]);
    const escapedEnvPath = envPath.replace(",", "%2C");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `::error file=${escapedEnvPath},title=envguard::Missing key MISSING (required by 100%25.example)\n`,
    );
  });

  test("escapes all workflow-command characters in file paths and message paths", () => {
    const report = createReport(
      { missing: ["MISSING"], empty: [], extra: [] },
      ".env",
      ".env.example",
    );

    expect(formatGithub(report, "C:\\a,b%c\r\nlocal.env", "100%\r\n.example")).toBe(
      "::error file=C%3A\\a%2Cb%25c%0D%0Alocal.env,title=envguard::Missing key MISSING (required by 100%25%0D%0A.example)",
    );
  });

  test("rejects --json and --github in either order, including before help", () => {
    for (const args of [
      ["--json", "--github"],
      ["--github", "--json"],
      ["--json", "--github", "--help"],
      ["--github", "--json", "--help"],
    ]) {
      const result = runCli(args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("envguard: --json and --github cannot be used together\n");
    }
  });

  test("validates --ignore-extra values before the --json and --github conflict", () => {
    const result = runCli(["--json", "--github", "--ignore-extra", "bad key"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "envguard: --ignore-extra needs a key name or a prefix ending in *\n",
    );
  });

  test("file and argument errors with --github leave stdout empty", () => {
    writeDefaults("A=1\n", "A=\n");
    rmSync(join(directory, ".env"));
    const missingFile = runCli(["--github"]);

    expect(missingFile.status).toBe(2);
    expect(missingFile.stdout).toBe("");
    expect(missingFile.stderr).toMatch(/^envguard: /);

    const unknownWithoutGithub = runCli(["--unknown"]);
    const unknownWithGithub = runCli(["--github", "--unknown"]);
    expect(unknownWithGithub.status).toBe(2);
    expect(unknownWithGithub.stdout).toBe("");
    expect(unknownWithGithub.stderr).toBe(unknownWithoutGithub.stderr);

    const positionalWithoutGithub = runCli(["positional.env"]);
    const positionalWithGithub = runCli(["positional.env", "--github"]);
    expect(positionalWithGithub.status).toBe(2);
    expect(positionalWithGithub.stdout).toBe("");
    expect(positionalWithGithub.stderr).toBe(positionalWithoutGithub.stderr);
  });

  test("--github=1 is rejected as an invalid boolean option value", () => {
    const result = runCli(["--github=1"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^envguard: .*github/i);
  });

  test("--github works with help and includes its description", () => {
    const result = runCli(["--github", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "  --github          Print GitHub Actions annotations (::error and ::warning lines)",
    );
  });

  test("README documents the option and its exact annotation example in a text block", () => {
    const readme = readFileSync(readmePath, "utf8");
    const expectedLines = [
      "::error file=.env,title=envguard::Missing key B (required by .env.example)",
      "::error file=.env,title=envguard::Empty value for key C",
      "::warning file=.env,title=envguard::Extra key CI (not in .env.example)",
    ];
    const textBlocks = [...readme.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map(
      (match) => match[1],
    );

    expect(readme).toContain("| `--github` |");
    expect(textBlocks.some((block) => block.includes(expectedLines.join("\n")))).toBe(true);
  });
});
