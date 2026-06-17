import { getGitHubSession } from "../auth";
import {
  fetchLatestRun,
  parseOwnerRepo,
  listRunArtifacts,
  findArtifact,
  downloadArtifactZip,
  extractJunitXml,
  WorkflowRun,
} from "../github";
import { parseJunitXml } from "../junit";
import {
  CiContext,
  CiProvider,
  CiReportResult,
  CiRunResult,
  NeedsAuthError,
} from "./ciProvider";

// The artifact GitHub Actions uploads the JUnit report under. A GitHub concept,
// so it lives with the GitHub provider.
const ARTIFACT_NAME = "test-results";

// Reads test results from GitHub Actions for the current branch: find the latest
// workflow run → download its `test-results` artifact → unzip → parse JUnit.
export class GitHubCiProvider implements CiProvider {
  readonly id = "github";
  readonly authActionLabel = "Sign in to GitHub";
  readonly authCommand = "test-radar.signIn";
  // A queued/in-progress run has no artifact to read, so each poll is one cheap
  // API call; 10s keeps the tree following it without hammering the API.
  readonly pollIntervalMs = 10_000;

  canHandle(ctx: CiContext): boolean {
    return ctx.remoteUrl ? parseOwnerRepo(ctx.remoteUrl) !== undefined : false;
  }

  async getLatestRun(ctx: CiContext): Promise<CiRunResult> {
    const ownerRepo = ctx.remoteUrl ? parseOwnerRepo(ctx.remoteUrl) : undefined;
    if (!ownerRepo) {
      return { kind: "noRun" };
    }

    const session = await getGitHubSession();
    if (!session) {
      throw new NeedsAuthError(this.id);
    }

    const run = await fetchLatestRun(
      ownerRepo.owner,
      ownerRepo.repo,
      ctx.branch,
      session.accessToken,
    );
    if (!run) {
      return { kind: "noRun" };
    }

    const report = await this.loadReport(
      ownerRepo.owner,
      ownerRepo.repo,
      run,
      session.accessToken,
    );
    return { kind: "run", run, report };
  }

  // Downloads and parses the run's test-results artifact. Artifact problems are
  // returned as `unavailable` rather than thrown, so they don't hide the run.
  private async loadReport(
    owner: string,
    repo: string,
    run: WorkflowRun,
    token: string,
  ): Promise<CiReportResult> {
    if (run.status !== "completed") {
      return { kind: "none" };
    }
    try {
      const artifacts = await listRunArtifacts(owner, repo, run.id, token);
      const artifact = findArtifact(artifacts, ARTIFACT_NAME);
      if (!artifact) {
        return { kind: "unavailable", reason: "No test-results artifact" };
      }
      const zip = await downloadArtifactZip(owner, repo, artifact.id, token);
      const xml = extractJunitXml(zip);
      if (!xml) {
        return { kind: "unavailable", reason: "Artifact has no junit.xml" };
      }
      return { kind: "ready", report: parseJunitXml(xml) };
    } catch (err) {
      return {
        kind: "unavailable",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
