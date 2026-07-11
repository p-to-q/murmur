import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DICT } from "./dict";

const DEFAULT_SOURCE_DIR = "src";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set(["_recovered"]);
const TRANSLATOR_CALL = /\bt\(\s*["']([^"']+)["']\s*\)/g;

export interface I18nAuditMissingKey {
  key: string;
  locations: string[];
}

export interface I18nAuditResult {
  status: "ok" | "missing";
  capturedAt: string;
  totalKeys: number;
  usedKeys: number;
  missingCount: number;
  missing: I18nAuditMissingKey[];
}

export function auditI18nUsage({
  cwd = process.cwd(),
  sourceDir = DEFAULT_SOURCE_DIR,
}: {
  cwd?: string;
  sourceDir?: string;
} = {}): I18nAuditResult {
  const sourceRoot = join(/* turbopackIgnore: true */ cwd, sourceDir);
  const dictKeys = new Set(Object.keys(DICT));
  const usedKeys = new Map<string, Set<string>>();

  for (const file of walk(sourceRoot)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(TRANSLATOR_CALL)) {
      const key = match[1];
      if (!key) continue;
      const locations = usedKeys.get(key) ?? new Set<string>();
      locations.add(file.replace(`${cwd}/`, ""));
      usedKeys.set(key, locations);
    }
  }

  const missing = [...usedKeys.keys()]
    .filter((key) => !dictKeys.has(key))
    .sort()
    .map((key) => ({
      key,
      locations: [...(usedKeys.get(key) ?? [])].sort(),
    }));

  return {
    status: missing.length === 0 ? "ok" : "missing",
    capturedAt: new Date().toISOString(),
    totalKeys: dictKeys.size,
    usedKeys: usedKeys.size,
    missingCount: missing.length,
    missing,
  };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      files.push(...walk(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extensionOf(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function extensionOf(file: string): string {
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index);
}
