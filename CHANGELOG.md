# Change Log

All notable changes to the Test Radar extension are documented here.
This project follows [Keep a Changelog](http://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [0.2.0]

- **CircleCI support.** Test Radar now reads test results from CircleCI as well as
  GitHub Actions. Set a CircleCI personal API token via **"Test Radar: Set CircleCI
  token"** (stored in VS Code Secret Storage), and Test Radar walks the latest
  pipeline for your branch to show failing tests — with the same click-to-jump-to-line
  and live polling.
- **Provider selection.** New `testRadar.provider` setting (`auto` · `github` ·
  `circleci`). Auto-detect uses CircleCI when `.circleci/config.yml` is present and
  there's no `.github/workflows/` directory; otherwise GitHub Actions.
- **CircleCI settings:** `testRadar.circleci.projectSlug` (derived from the Git
  remote when blank) and `testRadar.circleci.jobName` (the most-recent finished job
  with test metadata when blank).
- Falls back to a JUnit `*.xml` artifact when a CircleCI job's test metadata isn't
  available (e.g. `store_test_results` not configured).
- Renamed the run's inline action from "View run on GitHub" to **"View run"**, since
  it now opens the run on GitHub or CircleCI.

## [0.1.2]

- Fix the icon's rounded corners: they were opaque white (showing as white squares
  on dark editor themes). Re-rendered with a transparent background so the corners
  blend into any theme.

## [0.1.1]

- Fix the extension icon: re-rendered at full size (512×512) so it fills the frame
  on the Marketplace instead of appearing small in the corner.

## [0.1.0]

Initial release.

- **CI Test Results view** in the activity bar, scoped to your current Git branch.
- Finds the latest GitHub Actions run for the branch and shows its status.
- Downloads and parses the run's JUnit `test-results` artifact (Jest, Vitest,
  Playwright, Detox — anything that emits JUnit XML).
- Shows a pass/fail summary, with failing tests listed (grouped by file when they
  span several) and a friendly "all tests passed" state when everything is green.
- Click a failing test to open its file at the exact failing line.
- "View run on GitHub" action on the run, plus a manual refresh button.
- Auto-refreshes while a run is queued or in progress.
