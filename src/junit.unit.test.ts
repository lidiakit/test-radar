import { describe, it, expect } from "vitest";
import {
  parseJunitXml,
  groupByFile,
  groupByJob,
  mergeReports,
  type JunitReport,
  type TestCaseResult,
} from "./junit";

function failed(name: string, file: string): TestCaseResult {
  return { name, classname: file, file, status: "failed" };
}

function reportOf(cases: TestCaseResult[]): JunitReport {
  return {
    total: cases.length,
    failures: cases.filter((c) => c.status === "failed").length,
    cases,
  };
}

describe("parseJunitXml", () => {
  it("parses an all-passing suite", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
      <testsuites name="vitest" tests="2" failures="0">
        <testsuite name="src/a.test.ts" tests="2" failures="0">
          <testcase classname="src/a.test.ts" name="adds" time="0.01"/>
          <testcase classname="src/a.test.ts" name="subtracts" time="0.02"/>
        </testsuite>
      </testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.total).toBe(2);
    expect(report.failures).toBe(0);
    expect(report.cases.map((c) => c.status)).toEqual(["passed", "passed"]);
  });

  it("captures the failure body (summary + stack) over the attribute", () => {
    const xml = `<testsuites>
      <testsuite name="s">
        <testcase classname="src/a.test.ts" name="adds">
          <failure message="expected 2 to be 3">AssertionError: expected 2 to be 3
 ❯ src/a.test.ts:5:11</failure>
        </testcase>
      </testsuite>
    </testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.failures).toBe(1);
    expect(report.cases[0]).toMatchObject({
      name: "adds",
      classname: "src/a.test.ts",
      status: "failed",
    });
    // The body is preferred because it carries the stack frame we jump to.
    expect(report.cases[0].message).toContain("src/a.test.ts:5:11");
  });

  it("treats an <error> child as a failure", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="boom">
        <error message="ReferenceError: x is not defined"/>
      </testcase>
    </testsuite></testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.failures).toBe(1);
    expect(report.cases[0].status).toBe("failed");
    expect(report.cases[0].message).toBe("ReferenceError: x is not defined");
  });

  it("falls back to the failure body when there is no message attribute", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="bare">
        <failure>plain failure text</failure>
      </testcase>
    </testsuite></testsuites>`;

    expect(parseJunitXml(xml).cases[0].message).toBe("plain failure text");
  });

  it("marks a <skipped> case as skipped, not failed", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="later"><skipped/></testcase>
    </testsuite></testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.failures).toBe(0);
    expect(report.cases[0].status).toBe("skipped");
  });

  it("decodes XML entities in test names", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="parse &gt; works &amp; more"/>
    </testsuite></testsuites>`;

    expect(parseJunitXml(xml).cases[0].name).toBe("parse > works & more");
  });

  it("handles a single suite with a single testcase (no arrays)", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="only"/>
    </testsuite></testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.total).toBe(1);
    expect(report.cases[0].name).toBe("only");
  });

  it("flattens cases across multiple suites", () => {
    const xml = `<testsuites>
      <testsuite name="s1"><testcase classname="a" name="t1"/></testsuite>
      <testsuite name="s2">
        <testcase classname="b" name="t2"/>
        <testcase classname="b" name="t3"><failure message="x"/></testcase>
      </testsuite>
    </testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.total).toBe(3);
    expect(report.failures).toBe(1);
    expect(report.cases.map((c) => c.name)).toEqual(["t1", "t2", "t3"]);
  });

  it("accepts a bare <testsuite> root with no <testsuites> wrapper", () => {
    const xml = `<testsuite name="s" tests="1">
      <testcase classname="src/a.test.ts" name="solo"/>
    </testsuite>`;

    const report = parseJunitXml(xml);
    expect(report.total).toBe(1);
    expect(report.cases[0].name).toBe("solo");
  });

  it("returns an empty report for a suite with no cases", () => {
    const xml = `<testsuites><testsuite name="s" tests="0"/></testsuites>`;
    expect(parseJunitXml(xml)).toEqual({ total: 0, failures: 0, cases: [] });
  });

  it("captures the file attribute when the reporter records one", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="math suite" name="adds" file="src/math.test.ts"/>
    </testsuite></testsuites>`;

    expect(parseJunitXml(xml).cases[0].file).toBe("src/math.test.ts");
  });

  it("leaves file undefined when there is no file attribute", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="src/a.test.ts" name="adds"/>
    </testsuite></testsuites>`;

    expect(parseJunitXml(xml).cases[0].file).toBeUndefined();
  });
});

describe("groupByFile", () => {
  it("groups cases by file, preserving file and case order", () => {
    const cases = [
      failed("a1", "src/a.test.ts"),
      failed("b1", "src/b.test.ts"),
      failed("a2", "src/a.test.ts"),
    ];
    const groups = groupByFile(cases);
    expect(groups.map((g) => g.file)).toEqual(["src/a.test.ts", "src/b.test.ts"]);
    expect(groups[0].cases.map((c) => c.name)).toEqual(["a1", "a2"]);
    expect(groups[1].cases.map((c) => c.name)).toEqual(["b1"]);
  });

  it("falls back to classname when there is no file attribute", () => {
    const cases = [{ name: "x", classname: "suite/x", status: "failed" as const }];
    expect(groupByFile(cases).map((g) => g.file)).toEqual(["suite/x"]);
  });

  it("returns a single group when every case shares a file", () => {
    const groups = groupByFile([
      failed("a1", "src/a.test.ts"),
      failed("a2", "src/a.test.ts"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cases).toHaveLength(2);
  });

  it("returns an empty array for no cases", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

describe("mergeReports", () => {
  const passed = (name: string, job: string): TestCaseResult => ({
    name,
    classname: "src/x.test.ts",
    status: "passed",
    job,
  });
  const failedIn = (name: string, job: string): TestCaseResult => ({
    name,
    classname: "src/x.test.ts",
    status: "failed",
    job,
  });

  it("concatenates cases and sums counts across reports", () => {
    const a = reportOf([passed("a1", "unit"), failedIn("a2", "unit")]);
    const b = reportOf([passed("b1", "e2e")]);
    const merged = mergeReports([a, b]);
    expect(merged.total).toBe(3);
    expect(merged.failures).toBe(1);
    expect(merged.cases.map((c) => c.name)).toEqual(["a1", "a2", "b1"]);
    expect(merged.cases.map((c) => c.job)).toEqual(["unit", "unit", "e2e"]);
  });

  it("preserves the order the reports were given", () => {
    const merged = mergeReports([
      reportOf([passed("z", "e2e")]),
      reportOf([passed("a", "unit")]),
    ]);
    expect(merged.cases.map((c) => c.name)).toEqual(["z", "a"]);
  });

  it("re-derives counts from the cases rather than trusting inputs", () => {
    // A report whose stored counts disagree with its cases must not corrupt the
    // merge — the merged counts come from the actual cases.
    const bogus: JunitReport = {
      total: 99,
      failures: 99,
      cases: [passed("only", "unit")],
    };
    const merged = mergeReports([bogus]);
    expect(merged.total).toBe(1);
    expect(merged.failures).toBe(0);
  });

  it("returns an empty report for no inputs", () => {
    expect(mergeReports([])).toEqual({ total: 0, failures: 0, cases: [] });
  });
});

describe("groupByJob", () => {
  const inJob = (name: string, job?: string): TestCaseResult => ({
    name,
    classname: "src/x.test.ts",
    status: "failed",
    job,
  });

  it("groups by job, preserving job and case order", () => {
    const groups = groupByJob([
      inJob("a1", "unit"),
      inJob("b1", "e2e"),
      inJob("a2", "unit"),
    ]);
    expect(groups.map((g) => g.job)).toEqual(["unit", "e2e"]);
    expect(groups[0].cases.map((c) => c.name)).toEqual(["a1", "a2"]);
    expect(groups[1].cases.map((c) => c.name)).toEqual(["b1"]);
  });

  it("collapses untagged cases into a single undefined group", () => {
    // GitHub / single-job CircleCI: no job tags → one group → callers render
    // plainly by file rather than adding a spurious job level.
    const groups = groupByJob([inJob("a"), inJob("b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].job).toBeUndefined();
    expect(groups[0].cases).toHaveLength(2);
  });

  it("returns an empty array for no cases", () => {
    expect(groupByJob([])).toEqual([]);
  });
});
