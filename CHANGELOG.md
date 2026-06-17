# Change Log

All notable changes to the Test Radar extension are documented here.
This project follows [Keep a Changelog](http://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

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
