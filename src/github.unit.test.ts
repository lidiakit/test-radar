import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseOwnerRepo,
  findArtifact,
  extractJunitXml,
  type Artifact,
} from "./github";

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: 1,
    name: "test-results",
    sizeInBytes: 100,
    expired: false,
    archiveDownloadUrl: "https://example.com/zip",
    ...overrides,
  };
}

describe("parseOwnerRepo", () => {
  it("parses an https URL", () => {
    expect(
      parseOwnerRepo("https://github.com/lidiakit/test-radar.git"),
    ).toEqual({
      owner: "lidiakit",
      repo: "test-radar",
    });
  });

  it("parses an https URL without .git", () => {
    expect(parseOwnerRepo("https://github.com/lidiakit/test-radar")).toEqual({
      owner: "lidiakit",
      repo: "test-radar",
    });
  });

  it("parses an ssh URL", () => {
    expect(parseOwnerRepo("git@github.com:lidiakit/test-radar.git")).toEqual({
      owner: "lidiakit",
      repo: "test-radar",
    });
  });

  it("returns undefined for a non-GitHub remote", () => {
    expect(
      parseOwnerRepo("https://gitlab.com/lidiakit/test-radar.git"),
    ).toBeUndefined();
  });
});

describe("findArtifact", () => {
  it("finds an artifact whose name matches exactly", () => {
    const artifacts = [
      makeArtifact({ id: 1, name: "coverage" }),
      makeArtifact({ id: 2, name: "test-results" }),
    ];
    expect(findArtifact(artifacts, "test-results")?.id).toBe(2);
  });

  it("returns undefined when no name matches", () => {
    const artifacts = [makeArtifact({ id: 1, name: "coverage" })];
    expect(findArtifact(artifacts, "test-results")).toBeUndefined();
  });

  it("returns undefined for an empty array", () => {
    expect(findArtifact([], "test-results")).toBeUndefined();
  });

  it("skips a matching artifact that is expired", () => {
    const artifacts = [
      makeArtifact({ id: 1, name: "test-results", expired: true }),
    ];
    expect(findArtifact(artifacts, "test-results")).toBeUndefined();
  });

  it("prefers a non-expired match over an expired one with the same name", () => {
    const artifacts = [
      makeArtifact({ id: 1, name: "test-results", expired: true }),
      makeArtifact({ id: 2, name: "test-results", expired: false }),
    ];
    expect(findArtifact(artifacts, "test-results")?.id).toBe(2);
  });

  it("returns the first when two non-expired artifacts share the name", () => {
    const artifacts = [
      makeArtifact({ id: 1, name: "test-results" }),
      makeArtifact({ id: 2, name: "test-results" }),
    ];
    expect(findArtifact(artifacts, "test-results")?.id).toBe(1);
  });
});

describe("extractJunitXml", () => {
  const xml = '<testsuites><testsuite name="x"/></testsuites>';

  it("extracts junit.xml from the ZIP root", () => {
    const zip = zipSync({ "junit.xml": strToU8(xml) });
    expect(extractJunitXml(zip)).toBe(xml);
  });

  it("extracts a nested */junit.xml when not at the root", () => {
    const zip = zipSync({ "test-results/junit.xml": strToU8(xml) });
    expect(extractJunitXml(zip)).toBe(xml);
  });

  it("ignores other files and returns the junit.xml content", () => {
    const zip = zipSync({
      "README.txt": strToU8("noise"),
      "junit.xml": strToU8(xml),
    });
    expect(extractJunitXml(zip)).toBe(xml);
  });

  it("returns undefined when no junit.xml is present", () => {
    const zip = zipSync({ "coverage.xml": strToU8("<coverage/>") });
    expect(extractJunitXml(zip)).toBeUndefined();
  });
});
