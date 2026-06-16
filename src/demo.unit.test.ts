import { describe, it, expect } from "vitest";

// TEMPORARY — added only to make CI produce a failing test so the Test Radar
// tree shows a red failure row to click. Remove this file before merging.
describe("demo failure", () => {
  it("fails on purpose so we can verify click-to-jump", () => {
    expect(2 + 2).toBe(5);
  });
});
