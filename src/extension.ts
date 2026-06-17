import * as vscode from "vscode";
import { TestRadarProvider } from "./testRadarProvider";
import { getGitAPI, GitRepository } from "./git";
import { signInToGitHub } from "./auth";
import { CIRCLECI_TOKEN_KEY } from "./providers/circleciProvider";

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("test-radar.signIn", async () => {
      try {
        const session = await signInToGitHub();
        vscode.window.showInformationMessage(
          `Test Radar: signed in to GitHub as ${session.account.label}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Test Radar: GitHub sign-in failed — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }),
  );

  const git = await getGitAPI();
  const provider = new TestRadarProvider(git, context);
  context.subscriptions.push(
    provider, // disposes the auto-refresh timer on deactivate
    vscode.window.registerTreeDataProvider("testRadar.results", provider),
    vscode.commands.registerCommand("test-radar.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand("test-radar.setCircleCiToken", () =>
      setCircleCiToken(context, provider),
    ),
    // Invoked from the run row's inline action; the tree item carries runUrl.
    vscode.commands.registerCommand(
      "test-radar.openRun",
      (item?: { runUrl?: string }) => {
        if (item?.runUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(item.runUrl));
        }
      },
    ),
  );

  // Kick off the first load of CI data.
  void provider.refresh();

  // Refresh the moment the user signs in or out of GitHub.
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === "github") {
        void provider.refresh();
      }
    }),
  );

  // Re-evaluate when any Test Radar setting changes (e.g. switching providers).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("testRadar")) {
        void provider.refresh();
      }
    }),
  );

  if (git) {
    // Refresh when a repo's state changes — e.g. you checkout a branch.
    const watchRepo = (repo: GitRepository) => {
      context.subscriptions.push(
        repo.state.onDidChange(() => provider.refresh()),
      );
    };
    git.repositories.forEach(watchRepo);

    // Repositories can open after we've activated — watch those too.
    context.subscriptions.push(
      git.onDidOpenRepository((repo) => {
        watchRepo(repo);
        provider.refresh();
      }),
    );
    context.subscriptions.push(
      git.onDidCloseRepository(() => provider.refresh()),
    );
  }
}

// Prompts for a CircleCI personal API token and stores it in VS Code Secret
// Storage (never a setting/log). An empty submit with a token already stored
// offers to clear it. The token is never echoed back. Refreshes on success.
async function setCircleCiToken(
  context: vscode.ExtensionContext,
  provider: TestRadarProvider,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    prompt: "CircleCI personal API token",
    placeHolder: "Paste token (stored in VS Code Secret Storage)",
  });

  // Cancelled (Esc) — leave everything as-is.
  if (input === undefined) {
    return;
  }

  if (input.trim() === "") {
    const existing = await context.secrets.get(CIRCLECI_TOKEN_KEY);
    if (existing) {
      const choice = await vscode.window.showWarningMessage(
        "Clear the stored CircleCI token?",
        "Clear",
      );
      if (choice === "Clear") {
        await context.secrets.delete(CIRCLECI_TOKEN_KEY);
        vscode.window.showInformationMessage("Test Radar: CircleCI token cleared");
        void provider.refresh();
      }
    }
    return;
  }

  await context.secrets.store(CIRCLECI_TOKEN_KEY, input.trim());
  // Confirmation must not echo the token.
  vscode.window.showInformationMessage("Test Radar: CircleCI token saved");
  void provider.refresh();
}

export function deactivate() {}
