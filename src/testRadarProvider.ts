import * as vscode from "vscode";
import { GitAPI } from "./git";
import { WorkflowRun, parseOwnerRepo } from "./github";
import { groupByFile, JunitReport, TestCaseResult } from "./junit";
import { findTestLine } from "./stack";
import {
  CiContext,
  CiProvider,
  CiReportResult,
  NeedsAuthError,
} from "./providers/ciProvider";
import { GitHubCiProvider } from "./providers/githubProvider";
import { selectProviderId } from "./providers/selection";

// The outcome of trying to load a run's test results. Provider-neutral; defined
// in the provider abstraction and reused here verbatim.
type ReportState = CiReportResult;

type LoadState =
  | { kind: "loading" }
  | { kind: "needsAuth"; actionLabel: string; authCommand: string }
  | { kind: "noRepo" }
  | { kind: "noRemote" }
  // A provider was selected but isn't wired up yet (CircleCI, until a later
  // piece). Shows a clean "coming soon" row instead of crashing.
  | { kind: "providerUnavailable"; label: string }
  | { kind: "error"; message: string }
  | {
      kind: "loaded";
      branch: string;
      run: WorkflowRun | undefined;
      report: ReportState;
      // Repo root, used to resolve a failing test's (repo-relative) file path
      // into an openable URI.
      rootUri: vscode.Uri;
    };

export class TestRadarProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: LoadState = { kind: "loading" };
  // Pending auto-refresh while a run is still running; undefined when idle.
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  // The provider serving the current state — drives the poll interval.
  private activeProvider: CiProvider | undefined;

  private readonly github = new GitHubCiProvider();

  constructor(
    private readonly git: GitAPI | undefined,
    private readonly context: vscode.ExtensionContext,
  ) {}

  dispose(): void {
    this.clearPoll();
    this._onDidChangeTreeData.dispose();
  }

  async refresh(): Promise<void> {
    const repo = this.git?.repositories[0];
    if (!repo) {
      return this.setState({ kind: "noRepo" });
    }

    const branch = repo.state.HEAD?.name;
    if (!branch) {
      return this.setState({
        kind: "error",
        message: "Not on a branch (detached HEAD)",
      });
    }

    const ctx: CiContext = {
      rootUri: repo.rootUri,
      remoteUrl: repo.state.remotes[0]?.fetchUrl,
      branch,
    };

    const provider = await this.selectProvider(ctx);
    this.activeProvider = provider;
    if (!provider) {
      return this.setState({
        kind: "providerUnavailable",
        label: "CircleCI results aren't available yet",
      });
    }
    if (!provider.canHandle(ctx)) {
      return this.setState({ kind: "noRemote" });
    }

    this.setState({ kind: "loading" });
    try {
      const result = await provider.getLatestRun(ctx);
      this.setState({
        kind: "loaded",
        branch,
        run: result.kind === "run" ? result.run : undefined,
        report: result.kind === "run" ? result.report : { kind: "none" },
        rootUri: repo.rootUri,
      });
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        return this.setState({
          kind: "needsAuth",
          actionLabel: provider.authActionLabel,
          authCommand: provider.authCommand,
        });
      }
      this.setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Picks the provider for this repo from the `testRadar.provider` setting plus
  // what CI config the repo has. Returns undefined when the chosen provider
  // isn't wired up yet (CircleCI, until a later piece) so the tree can show a
  // clean "coming soon" row. The pure decision lives in `selectProviderId`.
  private async selectProvider(
    ctx: CiContext,
  ): Promise<CiProvider | undefined> {
    const setting = vscode.workspace
      .getConfiguration("testRadar")
      .get<string>("provider", "auto");
    const hasCircleConfig = await pathExists(
      vscode.Uri.joinPath(ctx.rootUri, ".circleci", "config.yml"),
    );
    const hasGithubWorkflows = await pathExists(
      vscode.Uri.joinPath(ctx.rootUri, ".github", "workflows"),
    );
    const githubRemoteParses = ctx.remoteUrl
      ? parseOwnerRepo(ctx.remoteUrl) !== undefined
      : false;

    const id = selectProviderId(
      setting,
      hasCircleConfig,
      hasGithubWorkflows,
      githubRemoteParses,
    );
    if (id === "github") {
      return this.github;
    }
    // CircleCI is selected but not implemented yet.
    return undefined;
  }

  private setState(state: LoadState): void {
    this.state = state;
    // Any prior poll is now stale. Re-arm it only while a run is still going, so
    // the tree follows it queued → in progress → completed on its own.
    this.clearPoll();
    if (isRunInProgress(state)) {
      const interval = this.activeProvider?.pollIntervalMs ?? 10_000;
      this.pollTimer = setTimeout(() => void this.refresh(), interval);
    }
    this._onDidChangeTreeData.fire();
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof RunItem) {
      return runChildren(element.report, element.rootUri);
    }
    if (element instanceof FileGroupItem) {
      return element.cases.map((c) => failureRow(c, element.rootUri));
    }
    if (element) {
      return [];
    }
    return this.rootRows();
  }

  private rootRows(): vscode.TreeItem[] {
    switch (this.state.kind) {
      case "loading":
        return [labelRow("Loading…", "sync")];
      case "noRepo":
        return [labelRow("No Git repository open", "info")];
      case "noRemote":
        return [labelRow("No GitHub remote found", "info")];
      case "providerUnavailable":
        return [labelRow(this.state.label, "info")];
      case "needsAuth": {
        const item = new vscode.TreeItem(this.state.actionLabel);
        item.iconPath = new vscode.ThemeIcon("sign-in");
        item.command = {
          command: this.state.authCommand,
          title: this.state.actionLabel,
        };
        return [item];
      }
      case "error":
        return [labelRow(this.state.message, "error")];
      case "loaded": {
        const branchItem = new vscode.TreeItem(this.state.branch);
        branchItem.iconPath = new vscode.ThemeIcon("git-branch");
        branchItem.description = "current branch";

        if (!this.state.run) {
          return [
            branchItem,
            labelRow("No CI runs found for this branch", "info"),
          ];
        }
        return [
          branchItem,
          new RunItem(this.state.run, this.state.report, this.state.rootUri),
        ];
      }
    }
  }
}

// The run row. Expands to show failing tests when the parsed report has any.
// The "run" contextValue + runUrl drive the inline "View run on GitHub" action.
class RunItem extends vscode.TreeItem {
  readonly contextValue = "run";
  readonly runUrl: string;

  constructor(
    readonly run: WorkflowRun,
    readonly report: ReportState,
    readonly rootUri: vscode.Uri,
  ) {
    super(
      `Run #${run.runNumber} · ${runLabel(run)}`,
      isExpandable(report)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.iconPath = runIcon(run);
    this.description = summaryText(run, report);
    this.tooltip = `${run.name} — ${run.status}`;
    this.runUrl = run.htmlUrl;
  }
}

// True while the loaded run is queued or in progress — i.e. worth polling until
// it reaches "completed".
function isRunInProgress(state: LoadState): boolean {
  return (
    state.kind === "loaded" &&
    state.run !== undefined &&
    state.run.status !== "completed"
  );
}

// The run row expands whenever we have a parsed report (to show failures, an
// all-passed message, or "no tests") or an explanation of why results couldn't
// be loaded. Only an in-progress run (kind "none") has nothing underneath.
function isExpandable(report: ReportState): boolean {
  return report.kind === "ready" || report.kind === "unavailable";
}

// What the run row shows after its status: a test summary when we have a report,
// otherwise the workflow name (the prior behaviour).
function summaryText(run: WorkflowRun, report: ReportState): string {
  if (report.kind === "ready") {
    const { total, failures } = report.report;
    if (failures > 0) {
      return `${failures} of ${total} failed`;
    }
    const skipped = countSkipped(report.report);
    const passed = total - skipped;
    return skipped > 0 ? `${passed} passed, ${skipped} skipped` : `${passed} passed`;
  }
  return run.name;
}

function countSkipped(report: JunitReport): number {
  return report.cases.filter((c) => c.status === "skipped").length;
}

// Children of a run row: the failing tests, or a hint when the report couldn't
// be loaded. Failures in a single file are listed directly; when they span
// several files, they're grouped under one collapsible row per file so a long
// list stays scannable.
function runChildren(report: ReportState, rootUri: vscode.Uri): vscode.TreeItem[] {
  if (report.kind === "ready") {
    if (report.report.total === 0) {
      return [labelRow("No tests reported in this run", "info")];
    }
    const failures = report.report.cases.filter((c) => c.status === "failed");
    if (failures.length === 0) {
      // The happy path — a clear, friendly confirmation rather than a bare row.
      return [passRow(report.report)];
    }
    const groups = groupByFile(failures);
    if (groups.length > 1) {
      return groups.map((g) => new FileGroupItem(g.file, g.cases, rootUri));
    }
    return failures.map((c) => failureRow(c, rootUri));
  }
  if (report.kind === "unavailable") {
    return [labelRow(`Test results unavailable — ${report.reason}`, "warning")];
  }
  return [];
}

// Shown under a run where nothing failed: celebratory when everything ran green,
// neutral-positive when some tests were skipped.
function passRow(report: JunitReport): vscode.TreeItem {
  const skipped = countSkipped(report);
  const passed = report.total - skipped;
  const label =
    skipped > 0
      ? `${passed} passed, ${skipped} skipped`
      : `All ${passed} tests passed 🎉`;
  const item = new vscode.TreeItem(label);
  item.iconPath = new vscode.ThemeIcon(
    "pass",
    new vscode.ThemeColor("testing.iconPassed"),
  );
  return item;
}

// A per-file grouping row shown when failures span multiple files. Expands to
// the failing tests in that file.
class FileGroupItem extends vscode.TreeItem {
  constructor(
    readonly file: string,
    readonly cases: TestCaseResult[],
    readonly rootUri: vscode.Uri,
  ) {
    super(file, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("file");
    this.description = `${cases.length} failed`;
  }
}

function failureRow(
  testCase: TestCaseResult,
  rootUri: vscode.Uri,
): vscode.TreeItem {
  const item = new vscode.TreeItem(testCase.name);
  item.iconPath = new vscode.ThemeIcon(
    "error",
    new vscode.ThemeColor("testing.iconFailed"),
  );
  if (testCase.message) {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendCodeblock(testCase.message);
    item.tooltip = tooltip;
  }

  // Clicking the row opens the test's source file. Prefer an explicit `file`
  // attribute; fall back to `classname`, which is the file path for Vitest.
  const path = testCase.file ?? testCase.classname;
  const uri = resolveTestUri(rootUri, path);
  // Pin the exact failing line from the stack trace when we can find it.
  const line = findTestLine(testCase.message, path);
  item.description = line ? `${testCase.classname}:${line}` : testCase.classname;
  if (uri) {
    const args: unknown[] = [uri];
    if (line !== undefined) {
      const pos = new vscode.Position(line - 1, 0);
      const options: vscode.TextDocumentShowOptions = {
        selection: new vscode.Range(pos, pos),
      };
      args.push(options);
    }
    item.command = {
      command: "vscode.open",
      title: "Open Test File",
      arguments: args,
    };
  }
  return item;
}

// Resolves a test's recorded path to an openable URI. Absolute paths (some
// reporters emit them) are used as-is; repo-relative ones are joined onto the
// repo root. Returns undefined when there's no usable path.
function resolveTestUri(
  rootUri: vscode.Uri,
  path: string,
): vscode.Uri | undefined {
  if (!path) {
    return undefined;
  }
  if (path.startsWith("/")) {
    return vscode.Uri.file(path);
  }
  return vscode.Uri.joinPath(rootUri, path);
}

// Whether a workspace path exists (file or directory). `fs.stat` rejects when it
// doesn't, which we treat as "absent" — used for the `.circleci`/`.github` probes.
async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function labelRow(label: string, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function runLabel(run: WorkflowRun): string {
  if (run.status !== "completed") {
    return run.status.replace("_", " ");
  }
  return run.conclusion ?? "unknown";
}

function runIcon(run: WorkflowRun): vscode.ThemeIcon {
  if (run.status !== "completed") {
    return new vscode.ThemeIcon("sync");
  }
  switch (run.conclusion) {
    case "success":
      return new vscode.ThemeIcon(
        "pass",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    case "failure":
      return new vscode.ThemeIcon(
        "error",
        new vscode.ThemeColor("testing.iconFailed"),
      );
    default:
      return new vscode.ThemeIcon("circle-slash");
  }
}
