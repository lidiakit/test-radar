import * as vscode from "vscode";
import { GitAPI } from "./git";
import { getGitHubSession } from "./auth";
import { fetchLatestRun, parseOwnerRepo, WorkflowRun } from "./github";

type LoadState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "noRepo" }
  | { kind: "noRemote" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; branch: string; run: WorkflowRun | undefined };

export class TestRadarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: LoadState = { kind: "loading" };

  constructor(private readonly git: GitAPI | undefined) {}

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

    const remoteUrl = repo.state.remotes[0]?.fetchUrl;
    const ownerRepo = remoteUrl ? parseOwnerRepo(remoteUrl) : undefined;
    if (!ownerRepo) {
      return this.setState({ kind: "noRemote" });
    }

    const session = await getGitHubSession();
    if (!session) {
      return this.setState({ kind: "signedOut" });
    }

    this.setState({ kind: "loading" });
    try {
      const run = await fetchLatestRun(
        ownerRepo.owner,
        ownerRepo.repo,
        branch,
        session.accessToken,
      );
      this.setState({ kind: "loaded", branch, run });
    } catch (err) {
      this.setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private setState(state: LoadState): void {
    this.state = state;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
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
      case "signedOut": {
        const item = new vscode.TreeItem("Sign in to GitHub");
        item.iconPath = new vscode.ThemeIcon("sign-in");
        item.command = {
          command: "test-radar.signIn",
          title: "Sign in to GitHub",
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
        const run = this.state.run;
        const runItem = new vscode.TreeItem(
          `Run #${run.runNumber} · ${runLabel(run)}`,
        );
        runItem.iconPath = runIcon(run);
        runItem.description = run.name;
        runItem.tooltip = `${run.name} — ${run.status}`;
        return [branchItem, runItem];
      }
    }
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
