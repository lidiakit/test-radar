// Parses { owner, repo } from a GitHub remote URL (https or ssh). Pure and testable.
export function parseOwnerRepo(
  remoteUrl: string,
): { owner: string; repo: string } | undefined {
  const cleaned = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  // Matches https://github.com/owner/repo  and  git@github.com:owner/repo
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  return { owner: match[1], repo: match[2] };
}

export interface WorkflowRun {
  id: number;
  name: string;
  runNumber: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | … (null until done)
  htmlUrl: string;
  createdAt: string;
}

interface GitHubRun {
  id: number;
  name?: string;
  display_title?: string;
  run_number: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}
interface GitHubRunsResponse {
  workflow_runs?: GitHubRun[];
}

// Fetches the most recent workflow run for a branch (or undefined if there are none).
export async function fetchLatestRun(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<WorkflowRun | undefined> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/actions/runs` +
    `?branch=${encodeURIComponent(branch)}&per_page=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubRunsResponse;
  const run = data.workflow_runs?.[0];
  if (!run) {
    return undefined;
  }

  return {
    id: run.id,
    name: run.name ?? run.display_title ?? "CI run",
    runNumber: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
  };
}
