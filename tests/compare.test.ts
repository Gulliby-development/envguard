import { describe, expect, test } from "bun:test";
import { compareEnv } from "../src/compare";

describe("compareEnv", () => {
  test("reports missing, extra and empty keys together", () => {
    const env = new Map([
      ["A", "1"],
      ["C", ""],
      ["D", "4"],
    ]);
    const example = new Map([
      ["A", ""],
      ["B", ""],
      ["C", ""],
    ]);

    expect(compareEnv(env, example)).toEqual({
      missing: ["B"],
      extra: ["D"],
      empty: ["C"],
    });
  });

  test("returns empty lists for two empty maps", () => {
    expect(compareEnv(new Map(), new Map())).toEqual({
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test("compares keys rather than requiring values to match", () => {
    const env = new Map([
      ["A", "actual"],
      ["B", "other"],
    ]);
    const example = new Map([
      ["B", "placeholder"],
      ["A", ""],
    ]);

    expect(compareEnv(env, example)).toEqual({
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test("reports all example keys as missing when env is empty", () => {
    expect(
      compareEnv(
        new Map(),
        new Map([
          ["B", ""],
          ["A", "value"],
        ]),
      ),
    ).toEqual({
      missing: ["A", "B"],
      extra: [],
      empty: [],
    });
  });

  test("reports all env keys as extra when the example is empty", () => {
    expect(
      compareEnv(
        new Map([
          ["B", ""],
          ["A", "value"],
        ]),
        new Map(),
      ),
    ).toEqual({
      missing: [],
      extra: ["A", "B"],
      empty: [],
    });
  });

  test.each(["", " ", "\t", " \t\r\n "])("treats a required value %j as empty", (value) => {
    expect(compareEnv(new Map([["REQUIRED", value]]), new Map([["REQUIRED", "sample"]]))).toEqual({
      missing: [],
      extra: [],
      empty: ["REQUIRED"],
    });
  });

  test("does not classify nonempty values with surrounding whitespace as empty", () => {
    expect(compareEnv(new Map([["A", " \t0\r\n "]]), new Map([["A", ""]]))).toEqual({
      missing: [],
      extra: [],
      empty: [],
    });
  });

  test("does not report empty extra keys in the empty category", () => {
    const env = new Map([
      ["REQUIRED", "set"],
      ["EXTRA_BLANK", ""],
      ["EXTRA_SPACE", " \t "],
    ]);

    expect(compareEnv(env, new Map([["REQUIRED", ""]]))).toEqual({
      missing: [],
      extra: ["EXTRA_BLANK", "EXTRA_SPACE"],
      empty: [],
    });
  });

  test("classifies an absent key as missing, not empty", () => {
    expect(compareEnv(new Map(), new Map([["REQUIRED", ""]]))).toEqual({
      missing: ["REQUIRED"],
      extra: [],
      empty: [],
    });
  });

  test("sorts every category alphabetically regardless of map insertion order", () => {
    const env = new Map([
      ["EXTRA_Z", "value"],
      ["EMPTY_Z", ""],
      ["EXTRA_A", "value"],
      ["EMPTY_A", " \t "],
    ]);
    const example = new Map([
      ["MISSING_Z", ""],
      ["EMPTY_Z", ""],
      ["MISSING_A", ""],
      ["EMPTY_A", ""],
    ]);

    expect(compareEnv(env, example)).toEqual({
      missing: ["MISSING_A", "MISSING_Z"],
      extra: ["EXTRA_A", "EXTRA_Z"],
      empty: ["EMPTY_A", "EMPTY_Z"],
    });
  });

  test("treats differently cased keys as distinct", () => {
    expect(compareEnv(new Map([["key", "value"]]), new Map([["KEY", ""]]))).toEqual({
      missing: ["KEY"],
      extra: ["key"],
      empty: [],
    });
  });

  test("leaves both input maps unchanged", () => {
    const env = new Map([
      ["Z", ""],
      ["EXTRA", "value"],
      ["A", "set"],
    ]);
    const example = new Map([
      ["Z", "sample"],
      ["MISSING", ""],
      ["A", ""],
    ]);
    const envBefore = [...env];
    const exampleBefore = [...example];

    compareEnv(env, example);

    expect([...env]).toEqual(envBefore);
    expect([...example]).toEqual(exampleBefore);
  });
});
