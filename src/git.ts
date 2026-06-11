import * as vscode from "vscode";

// A minimal slice of the built-in Git extension's API — just the parts we use.
// (The full official types live in Microsoft's git.d.ts; we declare only what we need.)
export interface GitRepositoryState {
  readonly HEAD?: { readonly name?: string; readonly commit?: string };
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly fetchUrl?: string;
  }>;
  readonly onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
}

export interface GitAPI {
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

// Activates the built-in Git extension if needed, then returns its API (or undefined).
export async function getGitAPI(): Promise<GitAPI | undefined> {
  const extension =
    vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!extension) {
    return undefined;
  }
  if (!extension.isActive) {
    await extension.activate();
  }
  return extension.exports.getAPI(1);
}
