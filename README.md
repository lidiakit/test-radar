# Test Radar — CI test results in your editor

**See which tests failed on your current branch in GitHub Actions, right in your editor — click a failure to jump straight to the test.** Works with Jest, Vitest, Playwright, Detox, and anything else that produces JUnit XML.

![Test Radar showing failing tests grouped by file, with click-to-jump](https://raw.githubusercontent.com/lidiakit/test-radar/main/media/demo.gif)

No more flipping to the browser to read CI logs. Test Radar watches the branch you're on, finds its latest GitHub Actions run, and shows the test results in a sidebar — green when you're good, and a tidy, clickable list of failures when you're not.

## Features

- **Branch-aware.** Automatically tracks your current Git branch and its latest GitHub Actions run.
- **Real test results, not just pass/fail.** Downloads and parses the run's JUnit report, so you see individual failing tests.
- **Click to jump.** Click a failing test to open its file at the exact failing line, parsed from the stack trace.
- **Grouped by file.** When failures span several files, they're grouped per file so a long list stays scannable.
- **A friendly green state.** When everything passes, you get a clear "All N tests passed 🎉" — not a blank panel.
- **Live updates.** Auto-refreshes while a run is queued or in progress, plus a manual refresh button.
- **One click to the full run.** "View run on GitHub" opens the Actions page in your browser.

![Test Radar showing a green run — all tests passed](https://raw.githubusercontent.com/lidiakit/test-radar/main/media/states.png)

## Requirements

Test Radar reads results that your CI **uploads as an artifact** — it doesn't run your tests. Two things need to be true:

1. **You're signed in to GitHub.** Run **"Test Radar: Sign in to GitHub"** from the Command Palette (or click the sign-in row in the view). This uses VS Code's built-in GitHub authentication.

2. **Your CI uploads a JUnit report as an artifact named `test-results`.** Your test runner needs to emit a JUnit XML file, and your workflow needs to upload it under exactly that name. For example:

   ```yaml
   - name: Run tests
     run: npm test            # configured to write a JUnit file, e.g. test-results/junit.xml

   - name: Upload test results
     if: always()             # upload even when tests fail
     uses: actions/upload-artifact@v4
     with:
       name: test-results     # Test Radar looks for this exact name
       path: test-results/junit.xml
   ```

   Most runners produce JUnit XML with a small config:
   - **Vitest** — `reporters: ['junit'], outputFile: 'test-results/junit.xml'`
   - **Jest / Detox** — the [`jest-junit`](https://www.npmjs.com/package/jest-junit) reporter
   - **Playwright** — `reporter: [['junit', { outputFile: 'test-results/junit.xml' }]]`

   The `if: always()` matters — without it, a failing test run skips the upload and Test Radar has nothing to show.

## Getting started

1. Install the extension and open a project hosted on GitHub.
2. Open the **Test Radar** view from the activity bar (the radar icon).
3. Sign in to GitHub when prompted.
4. Push a branch with the CI workflow above. Once a run finishes, its results appear in the view — click any failure to jump to the test.

## How it works

For the branch you're on, Test Radar asks the GitHub API for the latest workflow run, lists its artifacts, downloads the `test-results` ZIP, unzips it in memory, parses the JUnit XML, and renders it. Nothing is executed locally and no test code is run — it only reads what CI already produced.

## Extension settings

None yet. Test Radar works with zero configuration once your CI uploads the artifact.

## Known limitations

- **GitHub Actions only** (for now). Other CI providers aren't supported yet.
- The artifact must be named **`test-results`** and contain a `junit.xml`.
- Works with the first repository in the window.

## License

[MIT](LICENSE)
