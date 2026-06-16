import { describe, it, expect } from "vitest";

// TEMPORARY — failing test in file A to demo grouping-by-file. Remove before merge.
describe("demo A", () => {
  it("fails in file A", () => {
    expect("a").toBe("z");
  });
});
