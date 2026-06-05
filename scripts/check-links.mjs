#!/usr/bin/env node
/**
 * Local Markdown link checker.
 *
 * Relative links only. External URLs are intentionally skipped to keep checks
 * deterministic and fast in local runs and CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ignored = new Set([
  ".git",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (path.endsWith(".md")) out.push(path);
  }
  return out;
}

const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
const failures = [];

function stripLineSuffix(target) {
  return target.replace(/:\d+$/, "");
}

for (const file of walk(".")) {
  const body = readFileSync(file, "utf8");
  let match;
  while ((match = linkRe.exec(body))) {
    const raw = match[1].trim();
    if (
      !raw ||
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("#")
    ) {
      continue;
    }
    if (raw.startsWith("./#") || raw.startsWith("../#")) continue;
    const [target] = raw.split("#");
    if (!target) continue;
    const normalizedTarget = stripLineSuffix(target);
    const resolved = normalizedTarget.startsWith("/")
      ? normalize(normalizedTarget)
      : normalize(join(dirname(file), normalizedTarget));
    if (!existsSync(resolved)) failures.push(`${file} -> ${raw}`);
  }
}

if (failures.length) {
  console.error("Broken local Markdown links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Local Markdown links passed.");
