// CircleCI integration. Mirrors github.ts: pure, testable helpers up top, with
// the network functions added alongside in a later piece. Nothing here ever
// touches the API token — that stays inside the network layer.

import { JunitReport, TestCaseResult, TestStatus } from "./junit";

// Parses a CircleCI VCS project slug from a Git remote URL (https or ssh).
//
// CircleCI's v2 API addresses a project by a slug: `gh/{org}/{repo}` for GitHub
// and `bb/{org}/{repo}` for Bitbucket. The opaque `circleci/{org-id}/{project-id}`
// form (used by GitHub-App / GitLab projects) is NOT derivable from a remote —
// it must be set via `testRadar.circleci.projectSlug` (see resolveProjectSlug).
export function parseProjectSlug(remoteUrl: string): string | undefined {
  const cleaned = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  // Matches https://github.com/org/repo and git@github.com:org/repo
  const github = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (github) {
    return `gh/${github[1]}/${github[2]}`;
  }

  const bitbucket = cleaned.match(/bitbucket\.org[/:]([^/]+)\/([^/]+)$/);
  if (bitbucket) {
    return `bb/${bitbucket[1]}/${bitbucket[2]}`;
  }

  return undefined;
}

// Resolves the project slug to use: an explicit `testRadar.circleci.projectSlug`
// override always wins (the only way to reach opaque `circleci/{org-id}/{id}`
// projects); otherwise derive `gh/…`/`bb/…` from the remote. Undefined when
// neither yields a slug.
export function resolveProjectSlug(
  override: string | undefined,
  remoteUrl: string | undefined,
): string | undefined {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed;
  }
  return remoteUrl ? parseProjectSlug(remoteUrl) : undefined;
}

// One item from CircleCI's test-metadata endpoint (`GET …/{job-number}/tests`).
// Only the fields we map are typed; everything is optional because the payload
// varies by test framework and reporter.
export interface CircleTest {
  name?: string;
  classname?: string;
  file?: string;
  result?: string;
  message?: string;
}

// Maps a CircleCI `result` value to our test status, plus a message when the
// status warrants one.
//
// IMPORTANT — verified against a real Playwright `/tests` capture (496 items):
// the `result` field is NOT just success|failure|skipped|error. CircleCI derives
// it from the JUnit `<testcase>`'s child element, so a *passing* Playwright test
// (which attaches a trace via `<system-out>`) comes back as `result: "system-out"`
// — in that capture 491 of 496 passing tests were `system-out`, with zero
// `success`. So `system-out`/`system-err`/`success` ALL mean "passed".
//
// This is safe against false greens: JUnit classification prioritizes
// `<failure>`/`<error>` over `<system-out>`, so a test that actually failed comes
// back as `failure`/`error`, never `system-out` (confirmed — our seeded failing
// test had an attachment yet still reported `failure`). A genuinely unrecognized
// value still maps to `failed` (never passed, never green), carrying the raw
// value so it's visible rather than silently dropped.
function mapResult(
  result: string | undefined,
  message: string | undefined,
): { status: TestStatus; message?: string } {
  switch (result) {
    case "success":
    case "system-out":
    case "system-err":
      return { status: "passed" };
    case "skipped":
      return { status: "skipped" };
    case "failure":
    case "error":
      return { status: "failed", message: message || undefined };
    default:
      // Never a false green: an unknown result is treated as a failure and the
      // raw value is surfaced in the message rather than hidden.
      return {
        status: "failed",
        message: `Unrecognized CircleCI result: ${result ?? "(missing)"}`,
      };
  }
}

function toCase(item: CircleTest): TestCaseResult {
  const name = item.name ?? "";
  const classname = item.classname ?? "";
  // Playwright's payload omits `file` entirely; some reporters send an empty
  // string. Normalize both to undefined so failureRow's `file ?? classname`
  // fallback (classname is the repo-relative path) kicks in.
  const file = item.file ? item.file : undefined;
  const { status, message } = mapResult(item.result, item.message);
  return { name, classname, file, status, message };
}

// Maps CircleCI `/tests` items to the same JunitReport the rest of Test Radar
// consumes, so the tree needs no provider-specific code. No line logic here —
// failureRow already runs each case's `message` through findTestLine, and the
// real Playwright messages carry a parseable stack frame (e.g.
// `at /root/project/foo.ct.tsx:17:15`).
export function mapTestsToReport(items: CircleTest[]): JunitReport {
  const cases = items.map(toCase);
  const failures = cases.filter((c) => c.status === "failed").length;
  return { total: cases.length, failures, cases };
}
