import * as vscode from "vscode";
import { TestRadarProvider } from "./testRadarProvider";
import { getGitAPI, GitRepository } from "./git";
import { signInToGitHub } from "./auth";

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("test-radar.helloWorld", () => {
      vscode.window.showInformationMessage(
        "Hello World from Test Radar — CI test results in your editor!",
      );
    }),
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
  const provider = new TestRadarProvider(git);
  context.subscriptions.push(
    provider, // disposes the auto-refresh timer on deactivate
    vscode.window.registerTreeDataProvider("testRadar.results", provider),
    vscode.commands.registerCommand("test-radar.refresh", () =>
      provider.refresh(),
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

export function deactivate() {}
