// CircleCI integration. Mirrors github.ts: pure, testable helpers up top, then
// the network functions. Token hygiene is a hard requirement here: the token
// goes ONLY into the `Circle-Token` header — never a URL, query, log, error
// message, field, or return value.

import {
  JunitReport,
  TestCaseResult,
  TestStatus,
  parseJunitXml,
} from "./junit";
import { NeedsAuthError } from "./providers/needsAuth";

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

function toCase(item: CircleTest, jobName?: string): TestCaseResult {
  const name = item.name ?? "";
  const classname = item.classname ?? "";
  // Playwright's payload omits `file` entirely; some reporters send an empty
  // string. Normalize both to undefined so failureRow's `file ?? classname`
  // fallback (classname is the repo-relative path) kicks in.
  const file = item.file ? item.file : undefined;
  const { status, message } = mapResult(item.result, item.message);
  return { name, classname, file, status, message, job: jobName };
}

// Maps CircleCI `/tests` items to the same JunitReport the rest of Test Radar
// consumes, so the tree needs no provider-specific code. No line logic here —
// failureRow already runs each case's `message` through findTestLine, and the
// real Playwright messages carry a parseable stack frame (e.g.
// `at /root/project/foo.ct.tsx:17:15`).
//
// `jobName` tags every case with the job it came from. It's passed when results
// are aggregated across several jobs, so the tree can group by job; a single-job
// read leaves it undefined and renders by file as before.
export function mapTestsToReport(
  items: CircleTest[],
  jobName?: string,
): JunitReport {
  const cases = items.map((item) => toCase(item, jobName));
  const failures = cases.filter((c) => c.status === "failed").length;
  return { total: cases.length, failures, cases };
}

// ───────────────────────── navigation helpers (pure) ─────────────────────────

export interface CirclePipeline {
  id: string;
  number: number;
  created_at: string;
}

export interface CircleWorkflow {
  id: string;
  name: string;
  status: string;
  pipeline_number?: number;
}

export interface CircleJob {
  job_number?: number;
  name: string;
  status?: string;
  started_at?: string;
  stopped_at?: string;
  type?: string;
}

export interface CircleArtifact {
  path?: string;
  node_index?: number;
  url: string;
}

// A job tagged with the workflow that contains it — so "the run" can be the
// workflow that actually owns the test-bearing job, not an arbitrary first one.
export interface JobInWorkflow {
  job: CircleJob;
  workflow: CircleWorkflow;
}

// The most-recent pipeline. CircleCI doesn't guarantee list ordering, so sort by
// created_at descending rather than trusting index 0.
export function latestPipeline(
  pipelines: CirclePipeline[],
): CirclePipeline | undefined {
  return [...pipelines].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  )[0];
}

// The candidate test-bearing job. Pinned name → that job (located by name).
// Unpinned → the most-recent FINISHED job (by stopped_at). Jobs without a
// job_number (approval/hold gates) can't have test metadata, so they're skipped.
export function pickJob<T extends CircleJob>(
  jobs: T[],
  pinnedName?: string,
): T | undefined {
  const runnable = jobs.filter((j) => typeof j.job_number === "number");
  if (pinnedName) {
    return runnable.find((j) => j.name === pinnedName);
  }
  const finished = runnable.filter((j) => j.stopped_at);
  if (finished.length === 0) {
    return undefined;
  }
  return finished.reduce((a, b) =>
    (a.stopped_at ?? "") >= (b.stopped_at ?? "") ? a : b,
  );
}

// The candidate test-bearing jobs to aggregate, newest finished first. Like
// pickJob but returns ALL of them, since results are merged across jobs rather
// than read from a single one. CircleCI gives no a-priori "is this a test job?"
// signal, so we return every finished runnable job and let the caller drop the
// ones whose /tests (and artifact fallback) turn out empty — install/lint/build
// jobs simply contribute nothing.
//
// A pinned name still narrows to exactly that one job (as a single-element list,
// or empty if it isn't in this pipeline), so the existing "show one job" setting
// keeps working. Jobs without a job_number (approval/hold gates) can't have test
// metadata and are skipped. Sorted by stopped_at descending so the newest job
// leads — that ordering carries through to "the run" and the job grouping.
export function pickTestJobs<T extends CircleJob>(
  jobs: T[],
  pinnedName?: string,
): T[] {
  const runnable = jobs.filter((j) => typeof j.job_number === "number");
  if (pinnedName) {
    const pinned = runnable.find((j) => j.name === pinnedName);
    return pinned ? [pinned] : [];
  }
  return runnable
    .filter((j) => j.stopped_at)
    .sort((a, b) =>
      (a.stopped_at ?? "") < (b.stopped_at ?? "")
        ? 1
        : (a.stopped_at ?? "") > (b.stopped_at ?? "")
          ? -1
          : 0,
    );
}

// The JUnit artifact among a job's raw artifact files: prefer one whose path ends
// in `junit.xml`, else any `.xml`. CircleCI artifacts are individual raw files,
// not a zip — the caller fetches `url` and parses the XML directly.
export function pickJunitArtifact(
  items: CircleArtifact[],
): CircleArtifact | undefined {
  return (
    items.find((a) => a.path?.endsWith("junit.xml")) ??
    items.find((a) => a.path?.endsWith(".xml"))
  );
}

// Maps a CircleCI workflow status to the WorkflowRun shape the tree already
// reads. Terminal states become status:"completed" (stops polling); active ones
// stay non-completed (keeps the poll alive). The "run" is the workflow.
export function mapWorkflowStatus(status: string): {
  status: string;
  conclusion: string | null;
} {
  const terminal = [
    "success",
    "failed",
    "error",
    "canceled",
    "unauthorized",
    "not_run",
  ];
  const mappedStatus = terminal.includes(status) ? "completed" : "running";

  let conclusion: string | null;
  switch (status) {
    case "success":
      conclusion = "success";
      break;
    case "failed":
    case "error":
    case "unauthorized":
      conclusion = "failure";
      break;
    case "canceled":
      conclusion = "cancelled";
      break;
    default:
      conclusion = null;
  }
  return { status: mappedStatus, conclusion };
}

// The app URL for a workflow. Built from the slug segments + pipeline number +
// workflow id (for opaque `circleci/{org-id}/{project-id}` slugs the leading
// segments are UUIDs, which is exactly what app.circleci.com expects).
export function workflowHtmlUrl(
  slug: string,
  pipelineNumber: number,
  workflowId: string,
): string {
  return `https://app.circleci.com/pipelines/${slug}/${pipelineNumber}/workflows/${workflowId}`;
}

// ───────────────────────────── network layer ─────────────────────────────────
//
// The token goes ONLY into the Circle-Token header — never a URL/query/log. On
// !ok we throw `CircleCI API <status>: <statusText>` (no URL/headers/body),
// except 401/403 → NeedsAuthError. Raw fetch failures are re-wrapped so no
// request object carrying headers can propagate.

const API_BASE = "https://circleci.com/api/v2";

interface Page<T> {
  items?: T[];
  next_page_token?: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Encodes each org/repo segment of a slug while preserving the `/` separators.
function encodeSlug(slug: string): string {
  return slug.split("/").map(encodeURIComponent).join("/");
}

async function circleGet<T>(path: string, token: string): Promise<T> {
  // Back off on 429 a few times before giving up.
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        headers: { "Circle-Token": token, Accept: "application/json" },
      });
    } catch {
      // Re-wrap so no cause/request object (which could carry the header) leaks.
      throw new Error("CircleCI request failed");
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new NeedsAuthError("circleci");
    }
    if (!response.ok) {
      throw new Error(`CircleCI API ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}

// Follows `next_page_token` to completion (passed back as `?page-token=`).
async function circleGetAll<T>(path: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = pageToken
      ? `${path}${sep}page-token=${encodeURIComponent(pageToken)}`
      : path;
    const page = await circleGet<Page<T>>(url, token);
    if (page.items) {
      out.push(...page.items);
    }
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);
  return out;
}

export function fetchPipelines(
  slug: string,
  branch: string,
  token: string,
): Promise<CirclePipeline[]> {
  const path = `/project/${encodeSlug(slug)}/pipeline?branch=${encodeURIComponent(branch)}`;
  return circleGetAll<CirclePipeline>(path, token);
}

export function fetchWorkflows(
  pipelineId: string,
  token: string,
): Promise<CircleWorkflow[]> {
  return circleGetAll<CircleWorkflow>(
    `/pipeline/${encodeURIComponent(pipelineId)}/workflow`,
    token,
  );
}

export function fetchWorkflow(
  workflowId: string,
  token: string,
): Promise<CircleWorkflow> {
  return circleGet<CircleWorkflow>(
    `/workflow/${encodeURIComponent(workflowId)}`,
    token,
  );
}

export function fetchJobs(
  workflowId: string,
  token: string,
): Promise<CircleJob[]> {
  return circleGetAll<CircleJob>(
    `/workflow/${encodeURIComponent(workflowId)}/job`,
    token,
  );
}

export function fetchTests(
  slug: string,
  jobNumber: number,
  token: string,
): Promise<CircleTest[]> {
  return circleGetAll<CircleTest>(
    `/project/${encodeSlug(slug)}/${jobNumber}/tests`,
    token,
  );
}

export function fetchArtifacts(
  slug: string,
  jobNumber: number,
  token: string,
): Promise<CircleArtifact[]> {
  return circleGetAll<CircleArtifact>(
    `/project/${encodeSlug(slug)}/${jobNumber}/artifacts`,
    token,
  );
}

// Downloads a raw artifact file (e.g. junit.xml) and returns its text. The token
// is sent only to circleci.com hosts; artifact `url`s often 302 to a storage host
// (e.g. S3), and Node's fetch forwards CUSTOM headers across redirects — so we
// use redirect:"manual" and re-request the Location WITHOUT the token on any
// cross-origin (non-circleci.com) hop. Never sends the token to storage.
export async function downloadArtifactFile(
  url: string,
  token: string,
): Promise<string> {
  const sendToken = isCircleHost(url);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: sendToken ? { "Circle-Token": token } : {},
      redirect: "manual",
    });
  } catch {
    throw new Error("CircleCI request failed");
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      try {
        response = await fetch(location, {
          headers: isCircleHost(location) ? { "Circle-Token": token } : {},
          redirect: "follow",
        });
      } catch {
        throw new Error("CircleCI request failed");
      }
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new NeedsAuthError("circleci");
  }
  if (!response.ok) {
    throw new Error(`CircleCI API ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

function isCircleHost(url: string): boolean {
  try {
    return new URL(url).host.endsWith("circleci.com");
  } catch {
    return false;
  }
}

// Parses a downloaded JUnit XML artifact directly (CircleCI artifacts are raw
// files, NOT zipped — so this does NOT reuse github's extractJunitXml).
// `jobName` tags every case with its job (as `mapTestsToReport` does) so the
// artifact-fallback path aggregates by job like the `/tests` path.
export function parseArtifactXml(xml: string, jobName?: string): JunitReport {
  const report = parseJunitXml(xml);
  if (!jobName) {
    return report;
  }
  return {
    ...report,
    cases: report.cases.map((c) => ({ ...c, job: jobName })),
  };
}
