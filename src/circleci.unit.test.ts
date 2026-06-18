import { describe, it, expect } from "vitest";
import {
  parseProjectSlug,
  resolveProjectSlug,
  mapTestsToReport,
  parseArtifactXml,
  mapWorkflowStatus,
  pickJob,
  pickTestJobs,
  pickJunitArtifact,
  latestPipeline,
  workflowHtmlUrl,
  type CircleTest,
  type CircleJob,
  type CircleArtifact,
  type CirclePipeline,
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

  it("tags every case with the job name when one is given", () => {
    const report = mapTestsToReport(
      [
        { classname: "a", name: "p", result: "success" },
        { classname: "a", name: "f", result: "failure" },
      ],
      "run_unit_tests",
    );
    expect(report.cases.map((c) => c.job)).toEqual([
      "run_unit_tests",
      "run_unit_tests",
    ]);
  });

  it("leaves the job undefined when no name is given (single-job read)", () => {
    const report = mapTestsToReport([
      { classname: "a", name: "t", result: "success" },
    ]);
    expect(report.cases[0].job).toBeUndefined();
  });
});

describe("parseArtifactXml", () => {
  const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="passes"/>
      <testcase classname="src/a.test.ts" name="fails"><failure message="boom"/></testcase>
    </testsuite></testsuites>`;

  it("tags every case with the job name when one is given", () => {
    const report = parseArtifactXml(xml, "run_unit_tests");
    expect(report.cases.map((c) => c.job)).toEqual([
      "run_unit_tests",
      "run_unit_tests",
    ]);
    // Parsing itself is unaffected.
    expect(report.total).toBe(2);
    expect(report.failures).toBe(1);
  });

  it("leaves the job undefined when no name is given", () => {
    expect(parseArtifactXml(xml).cases[0].job).toBeUndefined();
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

describe("mapWorkflowStatus", () => {
  it("maps terminal states to completed with the right conclusion", () => {
    expect(mapWorkflowStatus("success")).toEqual({
      status: "completed",
      conclusion: "success",
    });
    expect(mapWorkflowStatus("failed")).toEqual({
      status: "completed",
      conclusion: "failure",
    });
    expect(mapWorkflowStatus("error")).toEqual({
      status: "completed",
      conclusion: "failure",
    });
    expect(mapWorkflowStatus("unauthorized")).toEqual({
      status: "completed",
      conclusion: "failure",
    });
    expect(mapWorkflowStatus("canceled")).toEqual({
      status: "completed",
      conclusion: "cancelled",
    });
    expect(mapWorkflowStatus("not_run")).toEqual({
      status: "completed",
      conclusion: null,
    });
  });

  it("keeps active states non-completed (poll stays alive) with null conclusion", () => {
    for (const s of ["running", "failing", "on_hold"]) {
      const mapped = mapWorkflowStatus(s);
      expect(mapped.status).not.toBe("completed");
      expect(mapped.conclusion).toBeNull();
    }
  });
});

describe("pickJob", () => {
  const jobs: CircleJob[] = [
    { name: "install", job_number: 1, stopped_at: "2026-06-17T10:00:00Z" },
    { name: "approve", type: "approval" }, // no job_number — a gate, never picked
    { name: "test", job_number: 3, stopped_at: "2026-06-17T10:05:00Z" },
    { name: "lint", job_number: 2, stopped_at: "2026-06-17T10:03:00Z" },
  ];

  it("unpinned: returns the most-recent finished job by stopped_at", () => {
    expect(pickJob(jobs)?.name).toBe("test");
  });

  it("pinned: locates the job by name", () => {
    expect(pickJob(jobs, "lint")?.job_number).toBe(2);
  });

  it("pinned: returns undefined when the name isn't found", () => {
    expect(pickJob(jobs, "nope")).toBeUndefined();
  });

  it("never picks a gate job without a job_number", () => {
    expect(pickJob([{ name: "approve", type: "approval" }])).toBeUndefined();
  });

  it("returns undefined when no job has finished yet", () => {
    expect(
      pickJob([{ name: "running", job_number: 9 }]), // no stopped_at
    ).toBeUndefined();
  });
});

describe("pickTestJobs", () => {
  const jobs: CircleJob[] = [
    { name: "install", job_number: 1, stopped_at: "2026-06-17T10:00:00Z" },
    { name: "approve", type: "approval" }, // no job_number — a gate, excluded
    { name: "test", job_number: 3, stopped_at: "2026-06-17T10:05:00Z" },
    { name: "lint", job_number: 2, stopped_at: "2026-06-17T10:03:00Z" },
    { name: "running", job_number: 9 }, // no stopped_at — not finished, excluded
  ];

  it("unpinned: returns every finished runnable job, newest first", () => {
    expect(pickTestJobs(jobs).map((j) => j.name)).toEqual([
      "test",
      "lint",
      "install",
    ]);
  });

  it("excludes gate jobs (no job_number) and jobs still running (no stopped_at)", () => {
    const names = pickTestJobs(jobs).map((j) => j.name);
    expect(names).not.toContain("approve");
    expect(names).not.toContain("running");
  });

  it("pinned: narrows to exactly that one job", () => {
    expect(pickTestJobs(jobs, "lint").map((j) => j.job_number)).toEqual([2]);
  });

  it("pinned: returns an empty list when the name isn't in this pipeline", () => {
    expect(pickTestJobs(jobs, "nope")).toEqual([]);
  });

  it("returns an empty list when nothing has finished yet", () => {
    expect(pickTestJobs([{ name: "running", job_number: 9 }])).toEqual([]);
  });

  it("does not mutate the input array's order", () => {
    const input: CircleJob[] = [
      { name: "b", job_number: 2, stopped_at: "2026-06-17T10:05:00Z" },
      { name: "a", job_number: 1, stopped_at: "2026-06-17T10:01:00Z" },
    ];
    pickTestJobs(input);
    expect(input.map((j) => j.name)).toEqual(["b", "a"]);
  });
});

describe("pickJunitArtifact", () => {
  const make = (path: string): CircleArtifact => ({
    path,
    url: `https://circleci.com/${path}`,
  });

  it("prefers a path ending in junit.xml", () => {
    const items = [make("out/results.xml"), make("out/junit.xml")];
    expect(pickJunitArtifact(items)?.path).toBe("out/junit.xml");
  });

  it("falls back to any .xml when no junit.xml is present", () => {
    expect(pickJunitArtifact([make("out/results.xml")])?.path).toBe(
      "out/results.xml",
    );
  });

  it("returns undefined when there's no xml artifact", () => {
    expect(pickJunitArtifact([make("out/trace.zip")])).toBeUndefined();
  });
});

describe("latestPipeline", () => {
  it("returns the pipeline with the newest created_at (order not assumed)", () => {
    const pipelines: CirclePipeline[] = [
      { id: "a", number: 1, created_at: "2026-06-17T10:00:00Z" },
      { id: "c", number: 3, created_at: "2026-06-17T12:00:00Z" },
      { id: "b", number: 2, created_at: "2026-06-17T11:00:00Z" },
    ];
    expect(latestPipeline(pipelines)?.id).toBe("c");
  });

  it("returns undefined for an empty list", () => {
    expect(latestPipeline([])).toBeUndefined();
  });
});

describe("workflowHtmlUrl", () => {
  it("builds an app.circleci.com URL from slug segments, pipeline number, workflow id", () => {
    expect(workflowHtmlUrl("gh/org/repo", 42, "wf-123")).toBe(
      "https://app.circleci.com/pipelines/gh/org/repo/42/workflows/wf-123",
    );
  });
});
