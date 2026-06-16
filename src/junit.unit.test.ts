import { describe, it, expect } from "vitest";
import { parseJunitXml } from "./junit";

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

  it("captures a failure's message from the message attribute", () => {
    const xml = `<testsuites>
      <testsuite name="s">
        <testcase classname="src/a.test.ts" name="adds">
          <failure message="expected 2 to be 3">AssertionError: at a.test.ts:5</failure>
        </testcase>
      </testsuite>
    </testsuites>`;

    const report = parseJunitXml(xml);
    expect(report.failures).toBe(1);
    expect(report.cases[0]).toMatchObject({
      name: "adds",
      classname: "src/a.test.ts",
      status: "failed",
      message: "expected 2 to be 3",
    });
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
