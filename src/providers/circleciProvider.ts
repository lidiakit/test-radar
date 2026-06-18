import * as vscode from "vscode";
import { WorkflowRun } from "../github";
import { JunitReport, mergeReports } from "../junit";
import {
  resolveProjectSlug,
  fetchPipelines,
  fetchWorkflows,
  fetchWorkflow,
  fetchJobs,
  fetchTests,
  fetchArtifacts,
  downloadArtifactFile,
  pickTestJobs,
  pickJunitArtifact,
  latestPipeline,
  mapWorkflowStatus,
  workflowHtmlUrl,
  mapTestsToReport,
  parseArtifactXml,
  CircleJob,
  CircleWorkflow,
  JobInWorkflow,
} from "../circleci";
import {
  CiContext,
  CiProvider,
  CiReportResult,
  CiRunResult,
} from "./ciProvider";
import { NeedsAuthError } from "./needsAuth";

// SecretStorage key for the CircleCI personal API token. The token is read only
// at call time as a local string — never on a field, setting, TreeItem, or log.
export const CIRCLECI_TOKEN_KEY = "testRadar.circleci.token";

// What we cache per branch so a poll while the workflow is still running costs a
// single status call instead of the full pipeline→workflow→job walk.
interface PollCache {
  branch: string;
  pipelineNumber: number;
  workflowId: string;
  lastStatus: string; // raw CircleCI workflow status
}

// Reads test results from CircleCI for the current branch: latest pipeline →
// its workflows → the test-bearing job → that job's test metadata (falling back
// to a JUnit artifact). The workflow that owns the shown job is "the run".
export class CircleCiProvider implements CiProvider {
  readonly id = "circleci";
  readonly authActionLabel = "Set CircleCI token";
  readonly authCommand = "test-radar.setCircleCiToken";
  // A multi-hop walk per refresh, so poll a little less often than GitHub.
  readonly pollIntervalMs = 15_000;

  private cache: PollCache | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  canHandle(ctx: CiContext): boolean {
    return resolveProjectSlug(this.slugOverride(), ctx.remoteUrl) !== undefined;
  }

  async getLatestRun(ctx: CiContext): Promise<CiRunResult> {
    const token = await this.requireToken();
    const slug = resolveProjectSlug(this.slugOverride(), ctx.remoteUrl);
    if (!slug) {
      return { kind: "noRun" };
    }
    const pinnedName = this.pinnedJobName();

    // Cheap poll path: while the cached workflow for this branch is still
    // running, re-check only its status. If it's now terminal, fall through to a
    // full walk so the just-finished job's results get loaded.
    if (
      this.cache &&
      this.cache.branch === ctx.branch &&
      !isTerminal(this.cache.lastStatus)
    ) {
      try {
        const wf = await fetchWorkflow(this.cache.workflowId, token);
        if (!isTerminal(wf.status)) {
          this.cache.lastStatus = wf.status;
          return {
            kind: "run",
            run: this.toRun(slug, this.cache.pipelineNumber, wf),
            report: { kind: "none" },
          };
        }
        // Just completed — fall through to the full walk below.
      } catch (err) {
        if (err instanceof NeedsAuthError) {
          throw err;
        }
        // Any other error: fall through and re-walk from scratch.
      }
    }

    return this.fullWalk(slug, ctx.branch, pinnedName, token);
  }

  private async fullWalk(
    slug: string,
    branch: string,
    pinnedName: string | undefined,
    token: string,
  ): Promise<CiRunResult> {
    const pipeline = latestPipeline(await fetchPipelines(slug, branch, token));
    if (!pipeline) {
      this.cache = undefined;
      return { kind: "noRun" };
    }

    const workflows = await fetchWorkflows(pipeline.id, token);
    if (workflows.length === 0) {
      this.cache = undefined;
      return { kind: "noRun" };
    }

    // Tag every job with its workflow so "the run" is the workflow that actually
    // owns the test-bearing job, not an arbitrary first one.
    const tagged: JobInWorkflow[] = [];
    for (const workflow of workflows) {
      const jobs = await fetchJobs(workflow.id, token);
      for (const job of jobs) {
        tagged.push({ job, workflow });
      }
    }

    // Every finished test-bearing job, newest first. We aggregate results across
    // all of them; a pinned jobName narrows this to the single named job.
    const testJobs = pickTestJobs(
      tagged.map((t) => t.job),
      pinnedName,
    );
    // "The run" is the workflow that owns the newest test job (pickTestJobs sorts
    // newest first); with no test job to anchor on, fall back to the first.
    const owning =
      testJobs.length > 0
        ? tagged.find((t) => t.job === testJobs[0])!.workflow
        : workflows[0];

    this.cache = {
      branch,
      pipelineNumber: pipeline.number,
      workflowId: owning.id,
      lastStatus: owning.status,
    };

    const report = await this.loadReport(
      slug,
      owning,
      testJobs,
      pinnedName,
      token,
    );
    return {
      kind: "run",
      run: this.toRun(slug, pipeline.number, owning),
      report,
    };
  }

  // Aggregates test metadata across every test-bearing job in the run, merging
  // each job's report (tagged with its job name) into one. NeedsAuthError
  // propagates (re-prompt); a single job that fails or has no data is skipped
  // rather than sinking the whole run.
  private async loadReport(
    slug: string,
    workflow: CircleWorkflow,
    testJobs: CircleJob[],
    pinnedName: string | undefined,
    token: string,
  ): Promise<CiReportResult> {
    if (mapWorkflowStatus(workflow.status).status !== "completed") {
      return { kind: "none" };
    }
    if (testJobs.length === 0) {
      return {
        kind: "unavailable",
        reason: pinnedName
          ? `Job "${pinnedName}" not found in this pipeline`
          : "No test metadata; set testRadar.circleci.jobName",
      };
    }

    const reports: JunitReport[] = [];
    let lastError: string | undefined;
    for (const job of testJobs) {
      try {
        const report = await this.loadJobReport(slug, job, token);
        if (report) {
          reports.push(report);
        }
      } catch (err) {
        // A re-prompt has to win over a silent skip; any other failure just
        // drops this one job so it can't sink the whole aggregate.
        if (err instanceof NeedsAuthError) {
          throw err;
        }
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const merged = mergeReports(reports);
    if (merged.total === 0) {
      // Nothing usable from any job: no store_test_results anywhere, or every
      // job's fetch failed. Surface the last real error when we have one so the
      // single-job case keeps its old diagnostic, else the generic hint.
      return {
        kind: "unavailable",
        reason: lastError ?? "No test metadata; set testRadar.circleci.jobName",
      };
    }
    return { kind: "ready", report: merged };
  }

  // One job's test metadata, tagged with its job name, falling back to a JUnit
  // artifact when `/tests` is empty (>250MB of results, or store_test_results
  // not configured). Returns null when the job simply has no test data; throws
  // on a fetch failure so the caller can record it (and re-prompt on auth).
  private async loadJobReport(
    slug: string,
    job: CircleJob,
    token: string,
  ): Promise<JunitReport | null> {
    const jobNumber = job.job_number;
    if (jobNumber === undefined) {
      return null; // pickTestJobs filters these out, but be defensive.
    }
    const tests = await fetchTests(slug, jobNumber, token);
    if (tests.length > 0) {
      return mapTestsToReport(tests, job.name);
    }
    // Empty /tests — try the raw JUnit artifact instead.
    const junit = pickJunitArtifact(
      await fetchArtifacts(slug, jobNumber, token),
    );
    if (!junit) {
      return null;
    }
    const xml = await downloadArtifactFile(junit.url, token);
    return parseArtifactXml(xml, job.name);
  }

  private toRun(
    slug: string,
    pipelineNumber: number,
    workflow: CircleWorkflow,
  ): WorkflowRun {
    const { status, conclusion } = mapWorkflowStatus(workflow.status);
    return {
      id: 0, // unused for CircleCI (the run is identified by the workflow id)
      name: workflow.name,
      runNumber: pipelineNumber,
      status,
      conclusion,
      htmlUrl: workflowHtmlUrl(slug, pipelineNumber, workflow.id),
      createdAt: "",
    };
  }

  private async requireToken(): Promise<string> {
    const token = await this.context.secrets.get(CIRCLECI_TOKEN_KEY);
    if (!token) {
      throw new NeedsAuthError(this.id);
    }
    return token;
  }

  private slugOverride(): string {
    return vscode.workspace
      .getConfiguration("testRadar.circleci")
      .get<string>("projectSlug", "");
  }

  private pinnedJobName(): string | undefined {
    const name = vscode.workspace
      .getConfiguration("testRadar.circleci")
      .get<string>("jobName", "")
      .trim();
    return name || undefined;
  }
}

function isTerminal(status: string): boolean {
  return mapWorkflowStatus(status).status === "completed";
}
