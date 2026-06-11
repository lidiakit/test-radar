import * as vscode from "vscode";

const GITHUB_PROVIDER = "github";

// The scopes we need: 'repo' lets us read GitHub Actions runs and artifacts,
// including on private repositories. GitHub's classic scopes have no narrower
// "read Actions only" option, so this is the minimum that actually works.
const SCOPES = ["repo"];

// Prompts the user to sign in if there's no session yet, then returns it.
export async function signInToGitHub(): Promise<vscode.AuthenticationSession> {
  return vscode.authentication.getSession(GITHUB_PROVIDER, SCOPES, {
    createIfNone: true,
  });
}

// Returns an existing session WITHOUT prompting, or undefined if not signed in.
export async function getGitHubSession(): Promise<
  vscode.AuthenticationSession | undefined
> {
  return vscode.authentication.getSession(GITHUB_PROVIDER, SCOPES, {
    createIfNone: false,
  });
}
