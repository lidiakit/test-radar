// CircleCI integration. Mirrors github.ts: pure, testable helpers up top, with
// the network functions added alongside in a later piece. Nothing here ever
// touches the API token — that stays inside the network layer.

// Parses a CircleCI VCS project slug from a Git remote URL (https or ssh).
//
// CircleCI's v2 API addresses a project by a slug: `gh/{org}/{repo}` for GitHub
// and `bb/{org}/{repo}` for Bitbucket. The opaque `circleci/{org-id}/{project-id}`
// form (used by GitHub-App / GitLab projects) is NOT derivable from a remote —
// it must be set via `testRadar.circleci.projectSlug` (see resolveProjectSlug).
export function parseProjectSlug(remoteUrl: string): string | undefined {
  const cleaned = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  // Matches https://github.com/org/repo and git@github.com:org/repo
  const github = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (github) {
    return `gh/${github[1]}/${github[2]}`;
  }

  const bitbucket = cleaned.match(/bitbucket\.org[/:]([^/]+)\/([^/]+)$/);
  if (bitbucket) {
    return `bb/${bitbucket[1]}/${bitbucket[2]}`;
  }

  return undefined;
}

// Resolves the project slug to use: an explicit `testRadar.circleci.projectSlug`
// override always wins (the only way to reach opaque `circleci/{org-id}/{id}`
// projects); otherwise derive `gh/…`/`bb/…` from the remote. Undefined when
// neither yields a slug.
export function resolveProjectSlug(
  override: string | undefined,
  remoteUrl: string | undefined,
): string | undefined {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed;
  }
  return remoteUrl ? parseProjectSlug(remoteUrl) : undefined;
}
