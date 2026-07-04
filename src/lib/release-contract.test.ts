import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { APP_BUILD } from "./release-metadata";

const repoRoot = path.join(import.meta.dir, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("release contract", () => {
  it("keeps package.json, build metadata, changelog, and docs aligned", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      version: string;
    };
    const changelog = readRepoFile("CHANGELOG.md");
    const releaseDoc = readRepoFile("docs/packaging-and-release.md");

    expect(changelog).toContain(`## [${packageJson.version}]`);
    expect(releaseDoc).toContain(`**SemVer**: \`${packageJson.version}\``);
    expect(releaseDoc).toContain(`**Build**: \`${APP_BUILD}\``);
    expect(releaseDoc).toContain("src/lib/release-metadata.ts");
  });
});
