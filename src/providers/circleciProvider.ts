import * as vscode from "vscode";
import { WorkflowRun } from "../github";
import {
  resolveProjectSlug,
  fetchPipelines,
  fetchWorkflows,
  fetchWorkflow,
  fetchJobs,
  fetchTests,
  fetchArtifacts,
  downloadArtifactFile,
  pickJob,
  pickJunitArtifact,
  latestPipeline,
  mapWorkflowStatus,
  workflowHtmlUrl,
  mapTestsToReport,
  parseArtifactXml,
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

    const picked = pickJob(
      tagged.map((t) => t.job),
      pinnedName,
    );
    const owning = picked
      ? tagged.find((t) => t.job === picked)!.workflow
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
      picked?.job_number,
      pinnedName,
      token,
    );
    return {
      kind: "run",
      run: this.toRun(slug, pipeline.number, owning),
      report,
    };
  }

  // Loads the shown job's test metadata, falling back to a JUnit artifact when
  // `/tests` is empty (>250MB of results, or store_test_results not configured).
  // NeedsAuthError propagates (re-prompt); other problems become `unavailable`
  // so they don't hide the run.
  private async loadReport(
    slug: string,
    workflow: CircleWorkflow,
    jobNumber: number | undefined,
    pinnedName: string | undefined,
    token: string,
  ): Promise<CiReportResult> {
    if (mapWorkflowStatus(workflow.status).status !== "completed") {
      return { kind: "none" };
    }
    if (jobNumber === undefined) {
      return {
        kind: "unavailable",
        reason: pinnedName
          ? `Job "${pinnedName}" not found in this pipeline`
          : "No test metadata; set testRadar.circleci.jobName",
      };
    }
    try {
      const tests = await fetchTests(slug, jobNumber, token);
      if (tests.length > 0) {
        return { kind: "ready", report: mapTestsToReport(tests) };
      }
      // Empty /tests — try the raw JUnit artifact instead.
      const junit = pickJunitArtifact(await fetchArtifacts(slug, jobNumber, token));
      if (!junit) {
        return {
          kind: "unavailable",
          reason: "No test metadata; set testRadar.circleci.jobName",
        };
      }
      const xml = await downloadArtifactFile(junit.url, token);
      return { kind: "ready", report: parseArtifactXml(xml) };
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        throw err;
      }
      return {
        kind: "unavailable",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
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
