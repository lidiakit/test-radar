import * as vscode from "vscode";
import { JunitReport } from "../junit";
import { WorkflowRun } from "../github";

// What a provider needs to know about the repo to find its CI results. Kept
// provider-neutral: the concrete provider decides how (and whether) to use the
// remote URL.
export interface CiContext {
  rootUri: vscode.Uri;
  remoteUrl?: string;
  branch: string;
}

// The outcome of trying to load a run's test results. Kept separate from the run
// itself so an expired/missing artifact still shows the run. Structurally
// identical to the old `ReportState` it replaces.
export type CiReportResult =
  | { kind: "none" } // run not completed yet — no results to expect
  | { kind: "unavailable"; reason: string } // no results, or couldn't read them
  | { kind: "ready"; report: JunitReport };

// The result of asking a provider for the latest run on the branch. `noRun`
// means the provider looked and there's simply nothing for this branch.
export type CiRunResult =
  | { kind: "run"; run: WorkflowRun; report: CiReportResult }
  | { kind: "noRun" };

// Re-exported from its own vscode-free module so the pure network layer can
// throw it without importing vscode. See ./needsAuth.
export { NeedsAuthError } from "./needsAuth";

// A CI backend Test Radar can read test results from. Auth is internal to each
// provider — the token never crosses this boundary; a provider throws
// `NeedsAuthError` when it can't authenticate.
export interface CiProvider {
  readonly id: string;
  // Label + command for the "needs auth" row this provider's auth requires.
  readonly authActionLabel: string;
  readonly authCommand: string;
  // How often to re-check a run that hasn't completed yet (ms). GitHub ≈10s,
  // CircleCI ≈15s — read when re-arming the poll timer.
  readonly pollIntervalMs: number;

  // Whether this provider can serve results for the given repo context.
  canHandle(ctx: CiContext): boolean;

  // Finds the latest run for the branch and loads its report. Throws
  // `NeedsAuthError` when credentials are missing or rejected.
  getLatestRun(ctx: CiContext): Promise<CiRunResult>;
}
