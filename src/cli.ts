#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareEnv } from "./compare";
import { createReport, formatHuman, formatJson } from "./format";
import { parseEnv } from "./parse";

const help = `Usage: envguard [options]

Compare .env against .env.example without displaying values.

Options:
  --env <path>      Environment file (default: .env)
  --example <path>  Required keys file (default: .env.example)
  --strict          Treat extra keys as errors rather than warnings
  --allow-empty <KEY>  Keys allowed to be empty; repeatable, comma-separated, KEY or PREFIX*
  --ignore-extra <KEY>  Extra keys to leave out of the report; repeatable, comma-separated, KEY or PREFIX*
  --json            Print one JSON report
  --help, -h        Show this help
  --version, -v     Show the package version

Exit codes:
  0  Required keys are present and non-empty (extras allowed unless strict)
  1  Missing keys, empty required values, or extra keys with --strict
  2  Usage or file IO error
`;

function parseKeyList(values: readonly string[] | undefined, optionName: string): string[] {
  const keys = (values ?? []).flatMap((value) => value.split(",").map((key) => key.trim()));
  if (keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_.]*\*?$/.test(key))) {
    throw new Error(`--${optionName} needs a key name or a prefix ending in *`);
  }
  return keys;
}

function main(): number {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        env: { type: "string", default: ".env" },
        example: { type: "string", default: ".env.example" },
        strict: { type: "boolean", default: false },
        "allow-empty": { type: "string", multiple: true },
        "ignore-extra": { type: "string", multiple: true },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });

    const allowEmpty = parseKeyList(values["allow-empty"], "allow-empty");
    const ignoreExtra = parseKeyList(values["ignore-extra"], "ignore-extra");

    if (values.help) {
      process.stdout.write(help);
      return 0;
    }
    if (values.version) {
      const manifest: { version?: unknown } = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      );
      if (typeof manifest.version !== "string") {
        throw new Error("package.json does not contain a version string");
      }
      process.stdout.write(`${manifest.version}\n`);
      return 0;
    }

    const envPath = resolve(values.env);
    const examplePath = resolve(values.example);
    const env = parseEnv(readFileSync(envPath, "utf8"));
    const example = parseEnv(readFileSync(examplePath, "utf8"));
    const report = createReport(
      compareEnv(env, example, allowEmpty, ignoreExtra),
      envPath,
      examplePath,
      values.strict,
    );
    const output = values.json ? formatJson(report) : formatHuman(report);
    process.stdout.write(`${output}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`envguard: ${message}\n`);
    return 2;
  }
}

process.exitCode = main();
