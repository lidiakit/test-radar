import { XMLParser } from "fast-xml-parser";

// A single test case lifted out of a JUnit report. `classname` is the source
// file/suite the runner recorded (e.g. "src/math.test.ts"); `name` is the full
// test name including any describe path. `file` is the source file path when the
// reporter records one as a `file` attribute (some do, some don't). `message`
// holds the failure/error text when the case failed, and is undefined otherwise.
export type TestStatus = "passed" | "failed" | "skipped";

export interface TestCaseResult {
  name: string;
  classname: string;
  file?: string;
  status: TestStatus;
  message?: string;
}

export interface JunitReport {
  total: number;
  failures: number;
  cases: TestCaseResult[];
}

// fast-xml-parser turns attributes into "@_"-prefixed keys and leaves element
// text under "#text". We keep attribute values as strings (no coercion) so test
// names like "adds 1 + 1" aren't mangled, and let entities (&gt; etc.) decode.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// JUnit lets a node appear once (object) or many times (array); normalise both
// to an array so callers can just iterate.
function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// A <failure>/<error> may be a bare string ("<failure>boom</failure>"), an
// object with a message attribute and/or text body, or self-closing. Prefer the
// message attribute, fall back to the body, and treat empty as "no message".
function failureMessage(node: unknown): string | undefined {
  if (node === undefined || node === null) {
    return undefined;
  }
  if (typeof node === "string") {
    return node || undefined;
  }
  const record = node as Record<string, unknown>;
  const message = record["@_message"] ?? record["#text"];
  const text = message === undefined ? undefined : String(message);
  return text || undefined;
}

function toCase(testcase: Record<string, unknown>): TestCaseResult {
  const name = String(testcase["@_name"] ?? "");
  const classname = String(testcase["@_classname"] ?? "");
  const fileAttr = testcase["@_file"];
  const file = fileAttr === undefined ? undefined : String(fileAttr);
  const base = { name, classname, file };

  // A failure or error child means the case failed; <skipped> means it didn't
  // run. fast-xml-parser collapses a repeated child to an array, so take the
  // first when there is more than one.
  const failure = testcase.failure ?? testcase.error;
  if (failure !== undefined) {
    const first = Array.isArray(failure) ? failure[0] : failure;
    return { ...base, status: "failed", message: failureMessage(first) };
  }
  if (testcase.skipped !== undefined) {
    return { ...base, status: "skipped" };
  }
  return { ...base, status: "passed" };
}

// Parses a JUnit XML string (as produced by Jest/Vitest/Playwright/Detox) into a
// flat list of test cases plus simple counts. Pure and unit-testable.
export function parseJunitXml(xml: string): JunitReport {
  const doc = parser.parse(xml) as Record<string, any>;

  // Most reporters wrap suites in <testsuites>, but some emit a single bare
  // <testsuite> at the root — accept either.
  const root = doc.testsuites;
  const suites = root
    ? toArray<Record<string, unknown>>(root.testsuite)
    : toArray<Record<string, unknown>>(doc.testsuite);

  const cases: TestCaseResult[] = [];
  for (const suite of suites) {
    for (const testcase of toArray<Record<string, unknown>>(
      suite.testcase as never,
    )) {
      cases.push(toCase(testcase));
    }
  }

  const failures = cases.filter((c) => c.status === "failed").length;
  return { total: cases.length, failures, cases };
}
