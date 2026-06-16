import { describe, it, expect } from "vitest";
import { findTestLine } from "./stack";

describe("findTestLine", () => {
  it("reads the line from a bare V8 frame (Vitest-style)", () => {
    const stack = [
      "AssertionError: expected 4 to be 5",
      "    at /Users/me/repo/src/math.test.ts:42:17",
    ].join("\n");
    expect(findTestLine(stack, "src/math.test.ts")).toBe(42);
  });

  it("reads the line from a parenthesised frame", () => {
    const stack =
      "    at Object.<anonymous> (/Users/me/repo/src/math.test.ts:7:5)";
    expect(findTestLine(stack, "src/math.test.ts")).toBe(7);
  });

  it("skips earlier frames in other files and finds the test file's frame", () => {
    const stack = [
      "Error: boom",
      "    at toBe (/repo/node_modules/vitest/dist/index.js:120:9)",
      "    at /repo/src/helpers.ts:8:3",
      "    at /repo/src/math.test.ts:30:11",
    ].join("\n");
    expect(findTestLine(stack, "src/math.test.ts")).toBe(30);
  });

  it("returns the first matching frame when the file appears twice", () => {
    const stack = [
      "    at /repo/src/math.test.ts:30:11",
      "    at /repo/src/math.test.ts:99:2",
    ].join("\n");
    expect(findTestLine(stack, "src/math.test.ts")).toBe(30);
  });

  it("normalises Windows backslash paths", () => {
    const stack = "    at C:\\work\\repo\\src\\math.test.ts:51:3";
    expect(findTestLine(stack, "src/math.test.ts")).toBe(51);
  });

  it("does not match a different file with the same suffix", () => {
    const stack = "    at /repo/src/notmath.test.ts:12:3";
    expect(findTestLine(stack, "math.test.ts")).toBeUndefined();
  });

  it("returns undefined when no frame references the file", () => {
    const stack = "    at /repo/src/other.test.ts:10:1";
    expect(findTestLine(stack, "src/math.test.ts")).toBeUndefined();
  });

  it("returns undefined for an empty or missing stack", () => {
    expect(findTestLine(undefined, "src/math.test.ts")).toBeUndefined();
    expect(findTestLine("", "src/math.test.ts")).toBeUndefined();
  });

  it("returns undefined when the file is empty", () => {
    expect(findTestLine("at /repo/src/math.test.ts:42:17", "")).toBeUndefined();
  });
});
