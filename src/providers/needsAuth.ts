// The uniform "needs auth" signal every provider throws when its credentials are
// missing (or were rejected). Carries no token/URL/header — only which provider
// needs attention, so the UI can render the right "set credentials" action.
//
// Defined in its own module (no `vscode` import) so the pure, unit-tested network
// layer in circleci.ts can throw it without pulling vscode into Vitest.
export class NeedsAuthError extends Error {
  constructor(readonly providerId: string) {
    super(`${providerId} needs authentication`);
    this.name = "NeedsAuthError";
  }
}
