import { describe, expect, test } from "bun:test";
import type { Comparison } from "../src/compare";
import { createReport, formatHuman, formatJson } from "../src/format";

const requiredKeyProblems: Comparison[] = [
  { missing: ["MISSING"], extra: [], empty: [] },
  { missing: [], extra: [], empty: ["EMPTY"] },
];
const outputCases: Comparison[] = [
  { missing: [], extra: [], empty: [] },
  { missing: ["MISSING"], extra: ["EXTRA"], empty: ["EMPTY"] },
  { missing: [], extra: ["EXTRA"], empty: [] },
];

describe("createReport", () => {
  test("copies and sorts each category without mutating the input", () => {
    const comparison = {
      missing: ["Z_MISSING", "A_MISSING"],
      extra: ["Z_EXTRA", "A_EXTRA"],
      empty: ["Z_EMPTY", "A_EMPTY"],
    };
    const report = createReport(comparison, ".env", ".env.example");

    expect(report).toEqual({
      ok: false,
      strict: false,
      env: ".env",
      example: ".env.example",
      missing: ["A_MISSING", "Z_MISSING"],
      extra: ["A_EXTRA", "Z_EXTRA"],
      empty: ["A_EMPTY", "Z_EMPTY"],
    });
    expect(comparison).toEqual({
      missing: ["Z_MISSING", "A_MISSING"],
      extra: ["Z_EXTRA", "A_EXTRA"],
      empty: ["Z_EMPTY", "A_EMPTY"],
    });
    expect(report.missing).not.toBe(comparison.missing);
    expect(report.extra).not.toBe(comparison.extra);
    expect(report.empty).not.toBe(comparison.empty);
  });

  test.each([false, true])("matching keys are ok with strict=%j", (strict) => {
    expect(
      createReport({ missing: [], extra: [], empty: [] }, ".env", ".env.example", strict),
    ).toEqual({
      ok: true,
      strict,
      env: ".env",
      example: ".env.example",
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test.each(requiredKeyProblems)(
    "missing or empty required keys fail in either mode: %j",
    (comparison) => {
      for (const strict of [false, true]) {
        expect(createReport(comparison, ".env", ".env.example", strict).ok).toBe(false);
      }
    },
  );

  test("extra keys alone are warnings by default and problems in strict mode", () => {
    const comparison = { missing: [], extra: ["EXTRA"], empty: [] };

    expect(createReport(comparison, ".env", ".env.example").ok).toBe(true);
    expect(createReport(comparison, ".env", ".env.example", true).ok).toBe(false);
  });
});

describe("formatJson", () => {
  test("produces a single JSON document with the exact schema and sorted arrays", () => {
    const report = createReport(
      {
        missing: ["Z_MISSING", "A_MISSING"],
        extra: ["Z_EXTRA", "A_EXTRA"],
        empty: ["Z_EMPTY", "A_EMPTY"],
      },
      ".env",
      ".env.example",
    );

    expect(JSON.parse(formatJson(report))).toEqual({
      ok: false,
      strict: false,
      env: ".env",
      example: ".env.example",
      missing: ["A_MISSING", "Z_MISSING"],
      extra: ["A_EXTRA", "Z_EXTRA"],
      empty: ["A_EMPTY", "Z_EMPTY"],
    });
  });

  test.each([false, true])(
    "preserves ok and strict for extra-only reports: strict=%j",
    (strict) => {
      const report = createReport(
        { missing: [], extra: ["EXTRA"], empty: [] },
        ".env",
        ".env.example",
        strict,
      );

      expect(JSON.parse(formatJson(report))).toEqual({
        ok: !strict,
        strict,
        env: ".env",
        example: ".env.example",
        missing: [],
        extra: ["EXTRA"],
        empty: [],
      });
    },
  );

  test("includes empty arrays for a successful report", () => {
    const report = createReport({ missing: [], extra: [], empty: [] }, ".env", ".env.example");

    expect(JSON.parse(formatJson(report))).toEqual({
      ok: true,
      strict: false,
      env: ".env",
      example: ".env.example",
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test("round-trips paths and key names that need JSON escaping", () => {
    const env = 'folder with spaces/quote".env';
    const example = "C:\\project\\.env.example";
    const report = createReport(
      { missing: ['QUOTE"KEY', "BACK\\SLASH"], extra: [], empty: [] },
      env,
      example,
    );

    expect(JSON.parse(formatJson(report))).toEqual(report);
  });
});

describe("formatHuman", () => {
  test("prints a success line without empty categories when keys match", () => {
    const output = formatHuman(
      createReport({ missing: [], extra: [], empty: [] }, ".env", ".env.example"),
    );

    expect(output).toMatch(/^Success:/m);
    expect(output).not.toContain("Missing keys");
    expect(output).not.toContain("Empty values");
    expect(output).not.toContain("Extra keys");
  });

  test.each([false, true])("lists sorted keys under their categories with strict=%j", (strict) => {
    const output = formatHuman(
      createReport(
        {
          missing: ["Z_MISSING", "A_MISSING"],
          extra: ["Z_EXTRA", "A_EXTRA"],
          empty: ["Z_EMPTY", "A_EMPTY"],
        },
        ".env",
        ".env.example",
        strict,
      ),
    );

    expect(output).toContain("Missing keys (errors): A_MISSING, Z_MISSING");
    expect(output).toContain("Empty values (errors): A_EMPTY, Z_EMPTY");
    expect(output).toContain(`Extra keys (${strict ? "errors" : "warnings"}): A_EXTRA, Z_EXTRA`);
    expect(output).not.toMatch(/^Success:/m);
  });

  test("prints success alongside an extra-key warning in default mode", () => {
    const output = formatHuman(
      createReport({ missing: [], extra: ["EXTRA"], empty: [] }, ".env", ".env.example"),
    );

    expect(output).toMatch(/^Success:/m);
    expect(output).toContain("Extra keys (warnings): EXTRA");
    expect(output).not.toContain("errors");
  });

  test("reports extra-only keys as errors without success in strict mode", () => {
    const output = formatHuman(
      createReport({ missing: [], extra: ["EXTRA"], empty: [] }, ".env", ".env.example", true),
    );

    expect(output).toContain("Extra keys (errors): EXTRA");
    expect(output).not.toContain("warnings");
    expect(output).not.toMatch(/^Success:/m);
  });

  test.each(requiredKeyProblems)(
    "does not print success for required-key problems: %j",
    (comparison) => {
      expect(formatHuman(createReport(comparison, ".env", ".env.example"))).not.toMatch(
        /^Success:/m,
      );
    },
  );
});

describe("plain output", () => {
  test.each(outputCases)("neither format emits ANSI escape codes for %j", (comparison) => {
    for (const strict of [false, true]) {
      const report = createReport(comparison, ".env", ".env.example", strict);

      expect(formatHuman(report)).not.toContain("\u001b");
      expect(formatJson(report)).not.toContain("\u001b");
    }
  });
});
