// Which CI provider to use for a repo. Pure and unit-tested so the decision is
// verifiable without a workspace; the caller does the filesystem/config reads and
// passes the results in as plain values.

export type ProviderId = "github" | "circleci";

// Decides the provider from the user's setting plus what the repo looks like.
//
// - An explicit `testRadar.provider` of "github"/"circleci" always wins.
// - On "auto" (the default), prefer CircleCI only when `.circleci/config.yml`
//   exists AND there's no `.github/workflows/` dir — this keeps zero-config
//   behavior for existing GitHub users (both present → stay on GitHub).
// - The one refinement `githubRemoteParses` adds: in "auto", if we'd otherwise
//   fall to GitHub but the remote isn't a GitHub URL we can read (so GitHub
//   Actions can't work anyway) and a CircleCI config is present, use CircleCI.
export function selectProviderId(
  setting: string,
  hasCircleConfig: boolean,
  hasGithubWorkflows: boolean,
  githubRemoteParses: boolean,
): ProviderId {
  if (setting === "github") {
    return "github";
  }
  if (setting === "circleci") {
    return "circleci";
  }
  // "auto" (and any unrecognized value, treated as auto).
  const githubUsable = hasGithubWorkflows && githubRemoteParses;
  if (hasCircleConfig && !githubUsable) {
    return "circleci";
  }
  return "github";
}
