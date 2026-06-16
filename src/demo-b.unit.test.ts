import { describe, it, expect } from "vitest";

// TEMPORARY — failing test in file B to demo grouping-by-file. Remove before merge.
describe("demo B", () => {
  it("fails in file B", () => {
    expect(1).toBe(2);
  });
});
