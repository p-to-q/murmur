import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";

const srcRoot = path.join(import.meta.dir, "..", "..");

function activeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "_recovered" ? [] : activeSourceFiles(filePath);
    }

    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }

    return [filePath];
  });
}

describe("Murmur store selector hygiene", () => {
  it("does not subscribe active code to the entire store", () => {
    const wholeStoreSubscriptions = activeSourceFiles(srcRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /useMurmurStore\s*\(\s*\)/.test(source)
        ? [path.relative(srcRoot, filePath)]
        : [];
    });

    expect(wholeStoreSubscriptions).toEqual([]);
  });
});
