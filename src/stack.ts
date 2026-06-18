// Pulls a line number out of a failure's stack trace.
//
// JUnit gives us the test's file path but not where in it the assertion failed —
// that lives in the stack trace inside the failure message. V8-style stacks (what
// Vitest, Jest and Node emit) reference frames as "…/path/to/file.ts:LINE:COL",
// either bare or wrapped in parentheses. We find the first frame that points at
// the test's own file and return its 1-based line, so the editor can jump there.

// Escapes a string for safe interpolation into a RegExp.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TestFrame {
  // The full path token of the matching frame, as it appears in the stack —
  // typically the absolute on-disk path at run time (e.g. a CI checkout path).
  // Forward-slash normalised. Unlike the JUnit classname, this carries any
  // testDir prefix (e.g. "playwright/") that the classname drops.
  path: string;
  // 1-based line within that file.
  line: number;
}

// Finds the first stack frame referencing `file` and returns both its full path
// token and 1-based line, or undefined when there's no stack, no file, or no
// matching frame.
export function findTestFrame(
  stack: string | undefined,
  file: string,
): TestFrame | undefined {
  if (!stack || !file) {
    return undefined;
  }

  // Normalise Windows separators so a single forward-slash pattern matches both,
  // and match the file path as a suffix of a frame (it appears as an absolute
  // path in the stack but a repo-relative one in JUnit). Capture the whole path
  // token, requiring the file to sit at a path boundary (start of the token, or
  // after a "/") so "math.test.ts" can't match inside "notmath.test.ts".
  const haystack = stack.replace(/\\/g, "/");
  const needle = escapeRegExp(file.replace(/\\/g, "/"));
  const re = new RegExp(
    `(?:^|[\\s(])((?:[^\\s()]*\\/)?${needle}):(\\d+)`,
    "gm",
  );

  // A Playwright message references the file twice: a leading header with the
  // testDir-relative path ("…/foo.spec.ts:LINE") and, deeper in the stack, the
  // absolute on-disk frame ("at /root/project/…/foo.spec.ts:LINE"). Take the
  // LINE from the first reference (the header — where the test is declared), but
  // prefer an ABSOLUTE path for `path`, since only that carries the full
  // checkout path we can map back to the workspace.
  let line: number | undefined;
  let firstPath: string | undefined;
  let absolutePath: string | undefined;
  for (const match of haystack.matchAll(re)) {
    const candidate = Number(match[2]);
    if (!(candidate > 0)) {
      continue;
    }
    if (line === undefined) {
      line = candidate;
      firstPath = match[1];
    }
    if (absolutePath === undefined && match[1].startsWith("/")) {
      absolutePath = match[1];
    }
  }

  if (line === undefined) {
    return undefined;
  }
  return { path: absolutePath ?? firstPath!, line };
}

// Returns the 1-based line of the first stack frame referencing `file`, or
// undefined when there's no stack, no file, or no matching frame (the caller then
// opens the file without a specific line).
export function findTestLine(
  stack: string | undefined,
  file: string,
): number | undefined {
  return findTestFrame(stack, file)?.line;
}

// Common CI checkout roots a stack-frame path sits under. Stripping one yields a
// repo-relative path that resolves against the local workspace. These are
// CircleCI's defaults (Docker runs as root → ~/project = /root/project; the
// `circleci` user → /home/circleci/project).
const CI_CHECKOUT_ROOTS = ["/root/project/", "/home/circleci/project/"];

// Turns a CI stack-frame path into a repo-relative path by stripping a known CI
// checkout root, or undefined when it doesn't sit under one. This recovers the
// real path (testDir prefix included) that the JUnit classname omits — so e2e
// tests, whose classname is relative to the Playwright testDir, still open.
export function repoRelativeFromCiPath(framePath: string): string | undefined {
  const normalised = framePath.replace(/\\/g, "/");
  for (const root of CI_CHECKOUT_ROOTS) {
    if (normalised.startsWith(root)) {
      return normalised.slice(root.length);
    }
  }
  return undefined;
}
