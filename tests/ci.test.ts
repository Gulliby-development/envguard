import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ciPath = fileURLToPath(new URL("../src/ci.ts", import.meta.url));

describe("CI command", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "envguard-ci-")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function writeDefaults(env: string, example: string): void {
    writeFileSync(join(directory, ".env"), env, "utf8");
    writeFileSync(join(directory, ".env.example"), example, "utf8");
  }

  function runCi(args: string[] = []) {
    const result = spawnSync(process.execPath, ["run", ciPath, ...args], {
      cwd: directory,
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

  test(".env.example A=\\nB=\\nC=\\n and .env A=1\\nC=\\nCI=true\\n produce exact GitHub errors", () => {
    writeFileSync(join(directory, ".env.example"), "A=\nB=\nC=\n", "utf8");
    writeFileSync(join(directory, ".env"), "A=1\nC=\nCI=true\n", "utf8");

    const result = runCi();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "::error file=.env,title=envguard::Missing key B (required by .env.example)",
        "::error file=.env,title=envguard::Empty value for key C",
        "::error file=.env,title=envguard::Extra key CI (not in .env.example)",
        "",
      ].join("\n"),
    );
    expect(result.stdout).not.toContain("1");
    expect(result.stdout).not.toContain("true");
  });

  test("Matching files with populated values produce no output and exit successfully", () => {
    writeDefaults("A=actual-value\n", "A=example-value\n");

    const result = runCi();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("Only extra CI, with --ignore-extra CI, produces no output and exits successfully", () => {
    writeDefaults("A=1\nCI=true\n", "A=\n");

    const result = runCi(["--ignore-extra", "CI"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("rejects --json with the GitHub conflict diagnostic", () => {
    writeDefaults("A=1\n", "A=\n");

    const result = runCi(["--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("envguard: --json and --github cannot be used together\n");
  });

  test("declares both commands, the multi-entry build, and CI documentation", () => {
    const manifest: {
      bin: Record<string, string>;
      scripts: Record<string, string>;
    } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(Object.entries(manifest.bin)).toEqual([
      ["envguard", "dist/cli.js"],
      ["envguard-ci", "dist/ci.js"],
    ]);
    expect(manifest.scripts.build).toBe(
      "bun build src/cli.ts src/ci.ts --outdir dist --target node",
    );

    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const sectionStart = readme.indexOf("### CI command");
    const exitCodesStart = readme.indexOf("### Exit codes");
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(exitCodesStart).toBeGreaterThan(sectionStart);

    const section = readme.slice(sectionStart, exitCodesStart);
    const code = String.fromCharCode(96);
    expect(section).toContain(
      code +
        "envguard-ci" +
        code +
        " is equivalent to " +
        code +
        "envguard --github --strict" +
        code,
    );
    expect(section).toContain("It accepts envguard's other options and has the same exit codes.");
    expect(section).toContain(`As with \`--github\`, \`--json\` is rejected.`);
    expect(section).toContain(`After \`bun run build\`, run it with \`node dist/ci.js\``);
    expect(section).toContain(
      code +
        "envguard-ci" +
        code +
        " after linking the checkout with " +
        code +
        "npm link" +
        code +
        ".",
    );
    expect(section).not.toContain(String.fromCharCode(96).repeat(3));
  });
});
