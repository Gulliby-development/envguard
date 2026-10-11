import { describe, expect, test } from "bun:test";
import { parseEnv } from "../src/parse";

describe("parseEnv", () => {
  test.each(["\n", "\r\n"])("parses the required forms with %j line endings", (newline) => {
    const text = ["export A=1", ' B = "x y" ', "C='z'", "D=abc # note", "# comment", "", "E="].join(
      newline,
    );

    expect(parseEnv(text)).toEqual(
      new Map([
        ["A", "1"],
        ["B", "x y"],
        ["C", "z"],
        ["D", "abc"],
        ["E", ""],
      ]),
    );
  });

  test.each(["\n", "\r\n"])("handles a leading BOM with %j line endings", (newline) => {
    expect(parseEnv(`\uFEFFFIRST=one${newline}SECOND=two${newline}`)).toEqual(
      new Map([
        ["FIRST", "one"],
        ["SECOND", "two"],
      ]),
    );
  });

  test("accepts spaces and tabs around keys and assignments", () => {
    expect(parseEnv("  KEY  =  value  \n\texport\tOTHER\t=\tsecond\t")).toEqual(
      new Map([
        ["KEY", "value"],
        ["OTHER", "second"],
      ]),
    );
  });

  test("accepts underscore, digit and dotted keys but ignores invalid keys", () => {
    const text = [
      "_KEY_2=value",
      "service.port=3000",
      "lowercase=yes",
      "2BAD=no",
      "BAD-KEY=no",
      "BAD KEY=no",
      "=no",
    ].join("\n");

    expect(parseEnv(text)).toEqual(
      new Map([
        ["_KEY_2", "value"],
        ["service.port", "3000"],
        ["lowercase", "yes"],
      ]),
    );
  });

  test("preserves whitespace and hashes inside either type of quote", () => {
    expect(parseEnv("DOUBLE=\"  a # b  \"\nSINGLE='  c # d  '")).toEqual(
      new Map([
        ["DOUBLE", "  a # b  "],
        ["SINGLE", "  c # d  "],
      ]),
    );
  });

  test("removes inline comments only after whitespace in unquoted values", () => {
    const text = "A=abc # note\nB=abc\t# note\nC=abc#literal\nD=a=b=c";
    expect(parseEnv(text)).toEqual(
      new Map([
        ["A", "abc"],
        ["B", "abc"],
        ["C", "abc#literal"],
        ["D", "a=b=c"],
      ]),
    );
  });

  test("keeps empty and whitespace-only quoted values as assignments", () => {
    const text = "A=\nB=  \nC=\"\"\nD=''\nE=\"  \"\nF=' \t '";
    expect(parseEnv(text)).toEqual(
      new Map([
        ["A", ""],
        ["B", ""],
        ["C", ""],
        ["D", ""],
        ["E", "  "],
        ["F", " \t "],
      ]),
    );
  });

  test("ignores comments, blanks and lines without assignments", () => {
    expect(parseEnv("\n\r\n  # ignored=value\n\t\nnot an assignment\nexport KEY")).toEqual(
      new Map<string, string>(),
    );
  });

  test("uses the last assignment for a duplicate key, including an empty value", () => {
    expect(parseEnv("KEY=first\nexport KEY='second'\nKEY=\nOTHER=kept")).toEqual(
      new Map([
        ["KEY", ""],
        ["OTHER", "kept"],
      ]),
    );
  });

  test("treats differently cased keys as distinct", () => {
    expect(parseEnv("KEY=upper\nkey=lower")).toEqual(
      new Map([
        ["KEY", "upper"],
        ["key", "lower"],
      ]),
    );
  });

  test("returns an empty map for empty input", () => {
    expect(parseEnv("")).toEqual(new Map<string, string>());
  });
});
