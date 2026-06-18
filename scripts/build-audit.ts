import { spawn } from "node:child_process";

const ALLOWED_WARNING_MARKERS = [
  "Encountered unexpected file in NFT list",
  "./src/lib/storage/adapters/local-fs.ts",
  "./src/app/api/storage/local/[...key]/route.ts",
];

const ALLOWED_WARNING_ROUTE = "/api/storage/local/[...key]";

async function main() {
  const output = await runBuild();

  const warningMatch = output.match(/Turbopack build encountered (\d+) warnings?:/);
  if (!warningMatch) {
    console.log("Build audit passed: no audited Next.js warnings detected.");
    return;
  }

  const count = Number(warningMatch[1]);
  const knownWarningOk =
    count === 1 &&
    ALLOWED_WARNING_MARKERS.every((marker) => output.includes(marker));

  if (!knownWarningOk) {
    console.error("Build audit failed: unexpected build warnings detected.");
    process.exitCode = 1;
    return;
  }

  console.warn(
    [
      "Build audit acknowledged a known legacy Next.js warning:",
      `- route: ${ALLOWED_WARNING_ROUTE}`,
      "- category: unexpected file in NFT list",
      "- status: non-blocking tooling edge under Next.js 16.2.x",
    ].join("\n"),
  );
}

function runBuild(): Promise<string> {
  return new Promise((resolve, reject) => {
    const bunExecutable = process.env.npm_execpath || "bun";
    const child = spawn(bunExecutable, ["run", "build"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let combined = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(combined);
        return;
      }
      reject(new Error(`bun run build exited with code ${code ?? "unknown"}`));
    });
  });
}

await main();
