import { unzipSync, strFromU8 } from "fflate";

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

export interface Artifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  archiveDownloadUrl: string;
}

interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  archive_download_url: string;
}
interface GitHubArtifactsResponse {
  artifacts?: GitHubArtifact[];
}

// Lists the artifacts a workflow run produced (e.g. the JUnit `test-results` ZIP).
export async function listRunArtifacts(
  owner: string,
  repo: string,
  runId: number,
  token: string,
): Promise<Artifact[]> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts` +
    `?per_page=100`;

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

  const data = (await response.json()) as GitHubArtifactsResponse;
  return (data.artifacts ?? []).map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    sizeInBytes: artifact.size_in_bytes,
    expired: artifact.expired,
    archiveDownloadUrl: artifact.archive_download_url,
  }));
}

// Finds the first non-expired artifact matching `name` exactly (expired ones
// are skipped because GitHub deletes their bytes and they can't be downloaded).
export function findArtifact(
  artifacts: Artifact[],
  name: string,
): Artifact | undefined {
  return artifacts.find((artifact) => artifact.name === name && !artifact.expired);
}

// Downloads an artifact's ZIP bytes. The `.../artifacts/{id}/zip` endpoint does
// NOT return the ZIP directly — it replies with a 302 to a short-lived signed
// blob URL on a different host. `fetch` follows that redirect automatically and
// correctly drops the Authorization header on the cross-origin hop (so the token
// isn't leaked), so we just read bytes off the final response.
export async function downloadArtifactZip(
  owner: string,
  repo: string,
  artifactId: number,
  token: string,
): Promise<Uint8Array> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`;

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

  return new Uint8Array(await response.arrayBuffer());
}

// Extracts `junit.xml` from an artifact ZIP's bytes, or undefined if absent.
// Pure (no I/O), so it's unit-testable. CI uploads the file at the ZIP root, but
// we also accept a nested `*/junit.xml` in case the artifact's layout changes.
export function extractJunitXml(zipBytes: Uint8Array): string | undefined {
  const files = unzipSync(zipBytes);
  const key =
    "junit.xml" in files
      ? "junit.xml"
      : Object.keys(files).find((name) => name.endsWith("/junit.xml"));
  if (!key) {
    return undefined;
  }
  return strFromU8(files[key]);
}
