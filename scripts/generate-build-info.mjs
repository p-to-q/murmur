import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function safeExec(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const iso =
  process.env.SITE_LAST_UPDATED_ISO ||
  safeExec('git log -1 --format=%cI') ||
  new Date().toISOString();

const outPath = resolve(process.cwd(), "src/lib/build-info.ts");
const contents = `export const SITE_LAST_UPDATED_ISO = ${JSON.stringify(iso)} as const\n`;

writeFileSync(outPath, contents, "utf8");
