import { describe, it, expect } from "vitest";
import { parseProjectSlug, resolveProjectSlug } from "./circleci";

describe("parseProjectSlug", () => {
  it("derives a gh/ slug from an https GitHub remote", () => {
    expect(parseProjectSlug("https://github.com/lidiakit/test-radar.git")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a gh/ slug from an https GitHub remote without .git", () => {
    expect(parseProjectSlug("https://github.com/lidiakit/test-radar")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a gh/ slug from an ssh GitHub remote", () => {
    expect(parseProjectSlug("git@github.com:lidiakit/test-radar.git")).toBe(
      "gh/lidiakit/test-radar",
    );
  });

  it("derives a bb/ slug from an https Bitbucket remote", () => {
    expect(parseProjectSlug("https://bitbucket.org/team/widget.git")).toBe(
      "bb/team/widget",
    );
  });

  it("derives a bb/ slug from an ssh Bitbucket remote", () => {
    expect(parseProjectSlug("git@bitbucket.org:team/widget.git")).toBe(
      "bb/team/widget",
    );
  });

  it("returns undefined for an unsupported host", () => {
    expect(
      parseProjectSlug("https://gitlab.com/team/widget.git"),
    ).toBeUndefined();
  });
});

describe("resolveProjectSlug", () => {
  it("prefers an explicit override over the remote", () => {
    expect(
      resolveProjectSlug(
        "gh/other/repo",
        "https://github.com/lidiakit/test-radar.git",
      ),
    ).toBe("gh/other/repo");
  });

  it("passes through an opaque circleci/ override (not derivable from a remote)", () => {
    const opaque = "circleci/AAaa1234-org/BBbb5678-proj";
    expect(resolveProjectSlug(opaque, undefined)).toBe(opaque);
  });

  it("falls back to the remote when the override is blank", () => {
    expect(
      resolveProjectSlug("", "https://github.com/lidiakit/test-radar.git"),
    ).toBe("gh/lidiakit/test-radar");
  });

  it("falls back to the remote when the override is whitespace", () => {
    expect(
      resolveProjectSlug("   ", "git@bitbucket.org:team/widget.git"),
    ).toBe("bb/team/widget");
  });

  it("trims a padded override", () => {
    expect(resolveProjectSlug("  gh/org/repo  ", undefined)).toBe(
      "gh/org/repo",
    );
  });

  it("returns undefined when neither override nor remote yields a slug", () => {
    expect(resolveProjectSlug(undefined, undefined)).toBeUndefined();
    expect(
      resolveProjectSlug("", "https://gitlab.com/team/widget.git"),
    ).toBeUndefined();
  });
});
