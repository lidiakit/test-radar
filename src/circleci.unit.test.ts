import { describe, it, expect } from "vitest";
import {
  parseProjectSlug,
  resolveProjectSlug,
  mapTestsToReport,
  type CircleTest,
} from "./circleci";
import { findTestLine } from "./stack";

// Real items captured from CircleCI's `/tests` endpoint for a Playwright
// component-test job (gh/Volt-Athletics/web_client_v3, job 44482). The capture
// had 496 items whose `result` values were exactly: system-out (491, all
// passing), failure (2), skipped (3) — no `success`, no `error`, and no `file`
// field on any item. These five are verbatim (failure message trimmed to the
// parts the parser/line-finder use). This is the same real-fixture rigor used
// for the JUnit ZIP tests.
const REAL_CAPTURE: CircleTest[] = [
  {
    classname: "__test-radar-verify__.ct.tsx",
    name: "Test Radar verification (TEMPORARY — delete me) › passes",
    result: "system-out",
    message:
      "[[ATTACHMENT|../test-results/__test-radar-verify__.ct.t-cffa0-EMPORARY-—-delete-me-passes-chromium/trace.zip]]",
    run_time: 0.009,
  } as CircleTest,
  {
    classname: "__test-radar-verify__.ct.tsx",
    name: "Test Radar verification (TEMPORARY — delete me) › fails on assertion",
    result: "failure",
    message:
      "[[ATTACHMENT|../test-results/__test-radar-verify__.ct.t-7f4d2-elete-me-fails-on-assertion-chromium/trace.zip]]" +
      "[chromium] › __test-radar-verify__.ct.tsx:15:3 › Test Radar verification (TEMPORARY — delete me) › fails on assertion \n\n" +
      "    Error: expect(received).toBe(expected) // Object.is equality\n\n" +
      "    Expected: 2\n    Received: 1\n\n" +
      "      15 |   test('fails on assertion', async () => {\n" +
      "      16 |     // Real expect() assertion failure — produces a stack frame at this file/line.\n" +
      "    > 17 |     expect(1).toBe(2)\n" +
      "         |               ^\n" +
      "        at /root/project/__test-radar-verify__.ct.tsx:17:15",
  },
  {
    classname: "__test-radar-verify__.ct.tsx",
    name: "Test Radar verification (TEMPORARY — delete me) › throws an error",
    // Playwright reports a thrown error as a JUnit <failure>, so CircleCI's
    // `result` is "failure" here — NOT "error". (The error mapping is still
    // covered separately below.)
    result: "failure",
    message:
      "[chromium] › __test-radar-verify__.ct.tsx:20:3 › Test Radar verification (TEMPORARY — delete me) › throws an error \n\n" +
      "    Error: Test Radar: intentional thrown error\n\n" +
      "    > 22 |     throw new Error('Test Radar: intentional thrown error')\n" +
      "        at /root/project/__test-radar-verify__.ct.tsx:22:11",
  },
  {
    classname: "__test-radar-verify__.ct.tsx",
    name: "Test Radar verification (TEMPORARY — delete me) › is skipped",
    result: "skipped",
    message: "",
  },
  {
    classname: "src/components/__common__/ActionLink/ActionLink.ct.tsx",
    name: "ActionLink Component › renders the icon, title, and helper text",
    result: "system-out",
    message:
      "[[ATTACHMENT|../test-results/src-components-__common__--c807e--icon-title-and-helper-text-chromium/trace.zip]]",
  },
];

describe("mapTestsToReport — real Playwright capture", () => {
  const report = mapTestsToReport(REAL_CAPTURE);

  it("maps system-out to passed (NOT failed) — the dominant passing state", () => {
    const passes = report.cases[0];
    expect(passes.status).toBe("passed");
    const componentPass = report.cases[4];
    expect(componentPass.status).toBe("passed");
  });

  it("maps failure to failed", () => {
    expect(report.cases[1].status).toBe("failed");
  });

  it("maps a Playwright thrown-error (reported as failure) to failed", () => {
    expect(report.cases[2].status).toBe("failed");
  });

  it("maps skipped to skipped", () => {
    expect(report.cases[3].status).toBe("skipped");
  });

  it("counts only real failures — no false reds from the 2 system-out passes", () => {
    expect(report.total).toBe(5);
    expect(report.failures).toBe(2);
  });

  it("normalizes the missing `file` field to undefined so classname is the fallback path", () => {
    expect(report.cases.every((c) => c.file === undefined)).toBe(true);
    // failureRow uses `file ?? classname`; classname is the repo-relative path.
    expect(report.cases[1].classname).toBe("__test-radar-verify__.ct.tsx");
  });

  it("resolves a failing line from the real message via findTestLine", () => {
    const fail = report.cases[1];
    const line = findTestLine(fail.message, fail.classname);
    expect(line).toBe(15);
  });

  it("returns undefined gracefully when a message has no parseable frame", () => {
    const skipped = report.cases[3];
    expect(findTestLine(skipped.message, skipped.classname)).toBeUndefined();
  });
});

describe("mapTestsToReport — result mapping", () => {
  it("maps success and system-err to passed", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "s", result: "success" },
      { classname: "b", name: "e", result: "system-err" },
    ]);
    expect(report.cases.map((c) => c.status)).toEqual(["passed", "passed"]);
    expect(report.failures).toBe(0);
  });

  it("maps error to failed", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "errored", result: "error", message: "boom" },
    ]);
    expect(report.cases[0].status).toBe("failed");
    expect(report.cases[0].message).toBe("boom");
  });

  it("maps an unknown result to failed (never passed), surfacing the raw value", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "weird", result: "flaky" },
    ]);
    expect(report.cases[0].status).toBe("failed");
    expect(report.cases[0].message).toBe("Unrecognized CircleCI result: flaky");
    // Counted as a failure → green state is suppressed.
    expect(report.failures).toBe(1);
  });

  it("treats a missing result as failed (never a false green)", () => {
    const report = mapTestsToReport([{ classname: "a", name: "noresult" }]);
    expect(report.cases[0].status).toBe("failed");
    expect(report.cases[0].message).toBe(
      "Unrecognized CircleCI result: (missing)",
    );
  });

  it("normalizes an empty-string file to undefined", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "t", result: "success", file: "" },
    ]);
    expect(report.cases[0].file).toBeUndefined();
  });

  it("keeps a populated file when present", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "t", result: "failure", file: "src/a.test.ts" },
    ]);
    expect(report.cases[0].file).toBe("src/a.test.ts");
  });
});

describe("parseProjectSlug", () => {
  it("derives a gh/ slug from an https GitHub remote", () => {
    expect(parseProjectSlug("https://github.com/lidiakit/test-radar.git")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a gh/ slug from an https GitHub remote without .git", () => {
    expect(parseProjectSlug("https://github.com/lidiakit/test-radar")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a gh/ slug from an ssh GitHub remote", () => {
    expect(parseProjectSlug("git@github.com:lidiakit/test-radar.git")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a bb/ slug from an https Bitbucket remote", () => {
    expect(parseProjectSlug("https://bitbucket.org/team/widget.git")).toBe(
      "bb/team/widget",
    );
  });

  it("derives a bb/ slug from an ssh Bitbucket remote", () => {
    expect(parseProjectSlug("git@bitbucket.org:team/widget.git")).toBe(
      "bb/team/widget",
    );
  });

  it("returns undefined for an unsupported host", () => {
    expect(
      parseProjectSlug("https://gitlab.com/team/widget.git"),
    ).toBeUndefined();
  });
});

describe("resolveProjectSlug", () => {
  it("prefers an explicit override over the remote", () => {
    expect(
      resolveProjectSlug(
        "gh/other/repo",
        "https://github.com/lidiakit/test-radar.git",
      ),
    ).toBe("gh/other/repo");
  });

  it("passes through an opaque circleci/ override (not derivable from a remote)", () => {
    const opaque = "circleci/AAaa1234-org/BBbb5678-proj";
    expect(resolveProjectSlug(opaque, undefined)).toBe(opaque);
  });

  it("falls back to the remote when the override is blank", () => {
    expect(
      resolveProjectSlug("", "https://github.com/lidiakit/test-radar.git"),
    ).toBe("gh/lidiakit/test-radar");
  });

  it("falls back to the remote when the override is whitespace", () => {
    expect(
      resolveProjectSlug("   ", "git@bitbucket.org:team/widget.git"),
    ).toBe("bb/team/widget");
  });

  it("trims a padded override", () => {
    expect(resolveProjectSlug("  gh/org/repo  ", undefined)).toBe(
      "gh/org/repo",
    );
  });

  it("returns undefined when neither override nor remote yields a slug", () => {
    expect(resolveProjectSlug(undefined, undefined)).toBeUndefined();
    expect(
      resolveProjectSlug("", "https://gitlab.com/team/widget.git"),
    ).toBeUndefined();
  });
});
