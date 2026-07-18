import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { APP_BUILD, APP_VERSION } from "./release-metadata";

const repoRoot = path.join(import.meta.dir, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readPackageVersion(): string {
  return (JSON.parse(readRepoFile("package.json")) as { version: string })
    .version;
}

describe("release contract", () => {
  it("keeps package.json, build metadata, changelog, and docs aligned", () => {
    const version = readPackageVersion();
    const changelog = readRepoFile("CHANGELOG.md");
    const releaseDoc = readRepoFile("docs/packaging-and-release.md");

    expect(APP_VERSION).toBe(version);
    expect(changelog).toContain(`## [${version}]`);
    expect(releaseDoc).toContain(`**SemVer**: \`${version}\``);
    expect(releaseDoc).toContain(`**Build**: \`${APP_BUILD}\``);
    expect(releaseDoc).toContain("src/lib/release-metadata.ts");
  });

  it("ships a versioned release note for the declared version", () => {
    const version = readPackageVersion();
    const relativePath = `docs/releases/${version}/release-notes.md`;
    const absolutePath = path.join(repoRoot, relativePath);

    expect(existsSync(absolutePath)).toBe(true);
  });

  it("references the declared version and build in the release note", () => {
    const version = readPackageVersion();
    const releaseNote = readRepoFile(`docs/releases/${version}/release-notes.md`);

    expect(releaseNote).toContain(`v${version}`);
    expect(releaseNote).toContain(`build ${APP_BUILD}`);
  });
});
