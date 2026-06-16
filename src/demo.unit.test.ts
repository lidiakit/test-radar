import { describe, it, expect } from "vitest";

// TEMPORARY — makes CI produce a failing test so the Test Radar tree shows a red
// row to click. Clicking should jump to the failing assertion line (shown as
// file:line in the row), not just open the top of the file. Remove before merge.
describe("demo failure", () => {
  it("fails on purpose so we can verify jump-to-line", () => {
    expect(2 + 2).toBe(5);
  });
});
