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

// Returns the 1-based line of the first stack frame referencing `file`, or
// undefined when there's no stack, no file, or no matching frame (the caller then
// opens the file without a specific line).
export function findTestLine(
  stack: string | undefined,
  file: string,
): number | undefined {
  if (!stack || !file) {
    return undefined;
  }

  // Normalise Windows separators so a single forward-slash pattern matches both,
  // and match the file path as a suffix of a frame (it appears as an absolute
  // path in the stack but a repo-relative one in JUnit). A boundary before the
  // path avoids "math.test.ts" matching inside "notmath.test.ts".
  const haystack = stack.replace(/\\/g, "/");
  const needle = escapeRegExp(file.replace(/\\/g, "/"));
  const match = haystack.match(new RegExp(`(?:^|[\\s(/])${needle}:(\\d+)`, "m"));
  if (!match) {
    return undefined;
  }

  const line = Number(match[1]);
  return line > 0 ? line : undefined;
}
