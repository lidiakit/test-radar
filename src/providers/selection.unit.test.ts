import { describe, it, expect } from "vitest";
import { selectProviderId } from "./selection";

describe("selectProviderId", () => {
  describe("explicit setting wins", () => {
    it('returns github for "github" regardless of repo shape', () => {
      expect(selectProviderId("github", true, false, false)).toBe("github");
      expect(selectProviderId("github", true, true, true)).toBe("github");
    });

    it('returns circleci for "circleci" regardless of repo shape', () => {
      expect(selectProviderId("circleci", false, true, true)).toBe("circleci");
      expect(selectProviderId("circleci", false, false, false)).toBe("circleci");
    });
  });

  describe("auto", () => {
    it("uses CircleCI when only .circleci/config.yml is present", () => {
      expect(selectProviderId("auto", true, false, true)).toBe("circleci");
    });

    it("stays on GitHub when both CI dirs are present (zero-config tie-break)", () => {
      expect(selectProviderId("auto", true, true, true)).toBe("github");
    });

    it("uses GitHub when only .github/workflows/ is present", () => {
      expect(selectProviderId("auto", false, true, true)).toBe("github");
    });

    it("defaults to GitHub when neither CI dir is present", () => {
      expect(selectProviderId("auto", false, false, true)).toBe("github");
    });

    it("uses CircleCI when both dirs exist but the remote isn't a usable GitHub URL", () => {
      // GitHub Actions can't run without a parseable GitHub remote, so a present
      // CircleCI config wins.
      expect(selectProviderId("auto", true, true, false)).toBe("circleci");
    });

    it("stays on GitHub when only github workflows exist even without a usable remote", () => {
      // No CircleCI config to fall back to → still GitHub (which will then
      // surface its own "no remote" state).
      expect(selectProviderId("auto", false, true, false)).toBe("github");
    });
  });

  it("treats an unrecognized setting as auto", () => {
    expect(selectProviderId("nonsense", true, false, true)).toBe("circleci");
    expect(selectProviderId("nonsense", false, false, true)).toBe("github");
  });
});
