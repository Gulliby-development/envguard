import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const readProject = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(readProject("package.json")) as {
  name: string;
  version: string;
  license: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe("project and documentation", () => {
  test("declares the CLI entry, development scripts and MIT license", () => {
    expect(manifest.name).toBe("envguard");
    expect(manifest.bin.envguard).toBe("dist/cli.js");
    expect(manifest.license).toBe("MIT");
    for (const script of ["typecheck", "lint", "test", "build"]) {
      expect(typeof manifest.scripts[script]).toBe("string");
      expect(manifest.scripts[script].trim().length).toBeGreaterThan(0);
    }
    expect(manifest.scripts.test).toBe("bun test");
    expect(manifest.scripts.build).toBe("bun build src/cli.ts --outfile dist/cli.js --target node");
    // Development tooling must not become a runtime installation requirement.
    for (const dependencies of [
      manifest.dependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ]) {
      expect(Object.keys(dependencies ?? {})).toEqual([]);
    }
  });

  test("ships the MIT grant, notice condition and warranty disclaimer", () => {
    const license = readProject("LICENSE");
    expect(license.startsWith("MIT License")).toBe(true);
    expect(license).toMatch(/^Copyright .+/m);
    expect(license).toContain("Permission is hereby granted, free of charge");
    expect(license).toContain("use, copy, modify, merge, publish, distribute, sublicense");
    expect(license).toContain("The above copyright notice and this permission notice");
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(license).toContain("IN NO EVENT SHALL THE");
  });

  test("README explains the tool, audience, installation, examples and development", () => {
    const readme = readProject("README.md");
    expect(readme).toMatch(/^# envguard\s*$/m);
    expect(readme).toMatch(/compares? .*\.env.*\.env\.example/i);
    expect(readme).toMatch(/^## Who it is for\s*$/m);
    expect(readme).toMatch(/developers|teams/i);
    expect(readme).toMatch(/^## Install\s*$/m);
    expect(readme).toContain("bun install");
    expect(readme).toContain("node dist/cli.js");
    expect(readme).toContain("npm link");
    expect(readme).toMatch(/^## Usage\s*$/m);
    const examples = [...readme.matchAll(/```sh\r?\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .join("\n");
    expect(examples).toMatch(/^bun run src\/cli\.ts\s*$/m);
    expect(examples).toMatch(/^node dist\/cli\.js\s*$/m);
    expect(examples).toContain("node dist/cli.js --strict");
    expect(examples).toContain("node dist/cli.js --json");
    expect(examples).toMatch(/--env\s+\S+.*--example\s+\S+/);
    expect(readme).toMatch(/exit codes/i);
    for (const code of [0, 1, 2]) {
      expect(readme).toMatch(new RegExp(`^\\|\\s*${code}\\s*\\|\\s*\\S`, "m"));
    }
    expect(readme).toMatch(/0 \| No problems/i);
    expect(readme).toMatch(/1 \| Missing or empty/i);
    expect(readme).toMatch(/2 \| Usage or file IO error/i);
    expect(readme).toMatch(/^## Development\s*$/m);
    for (const command of ["bun test", "bun run typecheck", "bun run lint", "bun run build"]) {
      expect(examples).toContain(command);
    }
  });

  test("includes parser, comparison, formatter and CLI test suites", () => {
    const files = readdirSync(join(root, "tests"));
    for (const suite of ["parse.test.ts", "compare.test.ts", "format.test.ts", "cli.test.ts"]) {
      expect(files).toContain(suite);
      expect(readProject(join("tests", suite))).toMatch(/\btest(?:\(|\.)/);
    }
  });

  test("all source module references are relative paths or Node built-ins", () => {
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
    const sourceFiles = readdirSync(join(root, "src"), {
      recursive: true,
      encoding: "utf8",
    }).filter((path) => path.endsWith(".ts"));
    expect(sourceFiles.length).toBeGreaterThanOrEqual(4);

    for (const path of sourceFiles) {
      const source = ts.createSourceFile(
        path,
        readProject(join("src", path)),
        ts.ScriptTarget.Latest,
        true,
      );
      const checkSpecifier = (specifier: ts.Node) => {
        expect(ts.isStringLiteral(specifier)).toBe(true);
        if (!ts.isStringLiteral(specifier)) return;
        const name = specifier.text;
        const allowed =
          name.startsWith("./") ||
          name.startsWith("../") ||
          builtins.has(name.replace(/^node:/, ""));
        expect(allowed, `${path} imports non-built-in module ${name}`).toBe(true);
      };
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) checkSpecifier(node.moduleSpecifier);
        } else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
          expect(node.arguments.length).toBe(1);
          if (node.arguments[0]) checkSpecifier(node.arguments[0]);
        } else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression
        ) {
          checkSpecifier(node.moduleReference.expression);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });

  test("build emits a Node shebang and the built CLI runs under Node", () => {
    const build = spawnSync(process.execPath, ["run", "build"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(build.error).toBeUndefined();
    expect(build.signal).toBeNull();
    expect(build.status, build.stdout + build.stderr).toBe(0);
    expect(readProject("dist/cli.js").split(/\r?\n/)[0]).toBe("#!/usr/bin/env node");

    for (const flag of ["--help", "--version"]) {
      const result = spawnSync("node", [join(root, "dist", "cli.js"), flag], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      if (flag === "--version") {
        expect(result.stdout.trim()).toBe(manifest.version);
      } else {
        expect(result.stdout).toMatch(/Usage: envguard/);
        for (const option of ["--env", "--example", "--strict", "--json", "--help", "--version"]) {
          expect(result.stdout).toContain(option);
        }
      }
    }
  }, 60_000);
});
