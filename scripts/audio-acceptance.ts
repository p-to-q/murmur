import { accessSync, constants, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

type StepConfig = {
  name: string;
  cwd?: string;
  command: string[];
};

type StepResult = {
  name: string;
  cwd: string;
  command: string[];
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

type ClosureSummary = {
  realDataSuites?: string[];
  latencyArchetypes?: Array<{
    kind: string;
    suite: string;
    case: string;
    summary: string;
  }>;
  engineeringTailSubfamilies?: Array<{
    kind: string;
    suite: string;
    case: string;
    summary: string;
  }>;
  weakFamilies?: Array<{
    suite: string;
    scope: string;
    avgPitchMatchScore?: number;
    avgMusicFeelScore?: number;
    warn?: number;
    fail?: number;
    error?: number;
  }>;
  weakTags?: Array<{
    suite: string;
    scope: string;
    avgPitchMatchScore?: number;
    avgMusicFeelScore?: number;
    warn?: number;
    fail?: number;
    error?: number;
  }>;
  primaryPathSlowProviders?: Array<{
    suite: string;
    provider: string;
    p95PitchMs?: number;
    priority?: number;
  }>;
  slowProviders?: Array<{
    suite: string;
    provider: string;
    p95PitchMs?: number;
    priority?: number;
  }>;
  nextActions?: string[];
};

type ClosureResult = {
  ok?: boolean;
  summary?: ClosureSummary;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workerRoot = resolve(repoRoot, "workers/audio-engine");
const reportDir = resolve(workerRoot, "tools/reports");
const closureMarkdownPath = resolve(reportDir, "audio-closure.md");
const acceptanceMarkdownPath = resolve(reportDir, "audio-acceptance.md");
const acceptanceJsonPath = resolve(reportDir, "audio-acceptance.json");

const includeLint = process.argv.includes("--with-lint");
const includeBuild = process.argv.includes("--with-build");
const pythonCommand = resolveAudioPythonCommand();

const steps: StepConfig[] = [
  {
    name: "audio_eval_workspace",
    cwd: workerRoot,
    command: [
      pythonCommand,
      "tools/scaffold_audio_eval_workspace.py",
      "--pretty",
    ],
  },
  {
    name: "seed_murmur_golden",
    cwd: workerRoot,
    command: [
      pythonCommand,
      "tools/seed_murmur_golden.py",
      "--pretty",
    ],
  },
  {
    name: "app_audio_tests",
    cwd: repoRoot,
    command: [
      "bun",
      "test",
      "src/lib/audio/fixture-rescue-policy.test.ts",
      "src/lib/audio/hum-support-visibility.test.ts",
      "src/lib/audio/hum-error-log-level.test.ts",
      "src/lib/observability/support-code.test.ts",
      "src/lib/platform/audio-worker.test.ts",
      "src/modules/music/humming-engine.test.ts",
      "src/app/api/transcribe/route.test.ts",
    ],
  },
  {
    name: "worker_audio_tests",
    cwd: workerRoot,
    command: [
      pythonCommand,
      "-m",
      "unittest",
      "tests.test_detectors",
      "tests.test_frames",
      "tests_full.test_pipeline",
      "tests_full.test_audio_audit",
      "tests_full.test_audio_eval_closure",
      "tests_full.test_prepare_public_dataset",
      "tests_full.test_build_dataset_manifest",
      "tests_full.test_scaffold_audio_eval_workspace",
      "tests_full.test_seed_murmur_golden",
    ],
  },
  {
    name: "audio_closure_report",
    cwd: workerRoot,
    command: [
      pythonCommand,
      "tools/audio_eval_closure.py",
      "--config",
      "tools/audio_eval_closure.report.json",
      "--markdown-out",
      "tools/reports/audio-closure.md",
    ],
  },
];

if (includeLint) {
  steps.push({
    name: "repo_lint",
    cwd: repoRoot,
    command: ["bun", "run", "lint"],
  });
}

if (includeBuild) {
  steps.push({
    name: "repo_build",
    cwd: repoRoot,
    command: ["bun", "run", "build"],
  });
}

async function main() {
  mkdirSync(reportDir, { recursive: true });

  const results: StepResult[] = [];
  let closure: ClosureResult | null = null;

  for (const step of steps) {
    const result = await runStep(step);
    results.push(result);
    if (step.name === "audio_closure_report") {
      closure = parseClosureOutput(result.stdout);
    }
  }

  const overallOk =
    results.every((result) => result.ok) && (closure?.ok ?? false);

  const report = {
    generatedAt: new Date().toISOString(),
    ok: overallOk,
    includeLint,
    includeBuild,
    mainLine:
      "Understand the user's melody faithfully, then repair only unstable or musically broken parts so the result still feels like their line but lands more like a song.",
    currentState: buildCurrentState(closure?.summary),
    next: buildNextActions(closure?.summary),
    steps: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: round1(result.durationMs),
      cwd: result.cwd,
      command: result.command,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    })),
    closureSummary: closure?.summary ?? null,
    artifacts: {
      closureMarkdownPath,
      acceptanceMarkdownPath,
      acceptanceJsonPath,
    },
  };

  await writeFile(acceptanceJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(acceptanceMarkdownPath, renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));

  if (!overallOk) {
    process.exitCode = 1;
  }
}

async function runStep(step: StepConfig): Promise<StepResult> {
  const cwd = step.cwd ?? repoRoot;
  const startedAt = performance.now();
  const proc = spawn(step.command[0] ?? "", step.command.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    proc.on("error", rejectExit);
    proc.on("close", (code) => {
      resolveExit(code ?? 1);
    });
  });

  return {
    name: step.name,
    cwd,
    command: step.command,
    ok: exitCode === 0,
    exitCode,
    durationMs: performance.now() - startedAt,
    stdout,
    stderr,
  };
}

function parseClosureOutput(stdout: string): ClosureResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ClosureResult;
  } catch {
    return null;
  }
}

function buildCurrentState(summary: ClosureSummary | undefined): string[] {
  const lines = [
    "The research-engineering loop is now local and repeatable: workspace scaffold, seeded local golden audio, app-side audio tests, worker tests, and closure evaluation can run from one command and write durable operator artifacts.",
  ];

  if (summary?.realDataSuites?.length) {
    lines.push(
      `Real-data suites currently in the loop: ${summary.realDataSuites.join(", ")}.`,
    );
  }

  const primarySlowest =
    summary?.primaryPathSlowProviders?.[0] ?? summary?.slowProviders?.[0];
  if (primarySlowest?.provider && typeof primarySlowest.p95PitchMs === "number") {
    lines.push(
      `The clearest remaining user-path bottleneck is ${primarySlowest.provider} latency in ${primarySlowest.suite} (p95 pitch ${round1(primarySlowest.p95PitchMs)} ms).`,
    );
  }

  const weakest = summary?.weakFamilies?.[0];
  if (weakest) {
    lines.push(
      `The weakest current quality bucket is ${weakest.scope} in ${weakest.suite}, which stays a real review target instead of being hidden by aggregate pass counts.`,
    );
  }

  const qualityTail = summary?.latencyArchetypes?.find(
    (item) => item.kind === "quality_tail",
  );
  if (qualityTail) {
    lines.push(
      `The slowest humming tail is currently a quality-tail case in ${qualityTail.suite} (${qualityTail.case}), where pYIN still appears to be buying fidelity rather than pure waste.`,
    );
  }

  const engineeringTail = summary?.latencyArchetypes?.find(
    (item) => item.kind === "engineering_tail",
  );
  if (engineeringTail) {
    lines.push(
      `The main reducible latency bucket is currently an engineering-tail case in ${engineeringTail.suite} (${engineeringTail.case}), where SwiftF0 still wins and the delay is mostly comparison overhead.`,
    );
  }

  if (summary?.engineeringTailSubfamilies?.length) {
    const kinds = summary.engineeringTailSubfamilies
      .map((item) => item.kind)
      .join(", ");
    lines.push(
      `The remaining engineering tail is now split into concrete subfamilies: ${kinds}.`,
    );
  }

  return lines;
}

function buildNextActions(summary: ClosureSummary | undefined): string[] {
  const nextActions = [...(summary?.nextActions ?? [])];
  if (!nextActions.length) {
    nextActions.push(
      "Keep HumTrans as the primary humming gate and continue reducing real-user-path latency.",
    );
  }
  nextActions.push(
    "After latency, keep pushing worker-side musical repair quality rather than growing front-door complexity.",
  );
  return dedupe(nextActions);
}

function renderMarkdown(report: {
  generatedAt: string;
  ok: boolean;
  includeLint: boolean;
  includeBuild: boolean;
  mainLine: string;
  currentState: string[];
  next: string[];
  steps: Array<{
    name: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    cwd: string;
    command: string[];
    stdoutTail: string;
    stderrTail: string;
  }>;
  closureSummary: ClosureSummary | null;
  artifacts: {
    closureMarkdownPath: string;
    acceptanceMarkdownPath: string;
    acceptanceJsonPath: string;
  };
}): string {
  const lines: string[] = [];
  lines.push("# Murmur Audio Acceptance Report");
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Overall status: \`${report.ok ? "ok" : "needs_attention"}\``);
  lines.push(`- Includes lint: \`${report.includeLint ? "yes" : "no"}\``);
  lines.push(`- Includes build: \`${report.includeBuild ? "yes" : "no"}\``);
  lines.push(
    `- Closure report: [audio-closure.md](${report.artifacts.closureMarkdownPath})`,
  );
  lines.push("");
  lines.push("## Main line");
  lines.push("");
  lines.push(report.mainLine);
  lines.push("");
  lines.push("## How we are doing");
  lines.push("");
  for (const item of report.currentState) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Step results");
  lines.push("");
  for (const step of report.steps) {
    lines.push(
      `- \`${step.name}\` -> \`${step.ok ? "ok" : `exit ${step.exitCode}`}\` in \`${step.durationMs} ms\``,
    );
    lines.push(`  - cwd: \`${step.cwd}\``);
    lines.push(`  - cmd: \`${step.command.join(" ")}\``);
  }
  if (report.closureSummary) {
    lines.push("");
    lines.push("## Closure summary");
    lines.push("");
    if (report.closureSummary.realDataSuites?.length) {
      lines.push(
        `- Real-data suites: \`${report.closureSummary.realDataSuites.join(", ")}\``,
      );
    }
    for (const slow of report.closureSummary.primaryPathSlowProviders ?? []) {
      if (typeof slow.p95PitchMs !== "number") continue;
      lines.push(
        `- Primary path slow provider: \`${slow.provider}\` in \`${slow.suite}\` at p95 pitch \`${round1(slow.p95PitchMs)} ms\``,
      );
    }
    for (const slow of report.closureSummary.slowProviders ?? []) {
      if (typeof slow.p95PitchMs !== "number") continue;
      lines.push(
        `- Slow provider: \`${slow.provider}\` in \`${slow.suite}\` at p95 pitch \`${round1(slow.p95PitchMs)} ms\``,
      );
    }
    for (const archetype of report.closureSummary.latencyArchetypes ?? []) {
      lines.push(
        `- Latency archetype: \`${archetype.kind}\` in \`${archetype.suite}\` via \`${archetype.case}\` — ${archetype.summary}`,
      );
    }
    for (const family of report.closureSummary.engineeringTailSubfamilies ?? []) {
      lines.push(
        `- Engineering-tail subfamily: \`${family.kind}\` in \`${family.suite}\` via \`${family.case}\` — ${family.summary}`,
      );
    }
    for (const weak of report.closureSummary.weakFamilies ?? []) {
      lines.push(
        `- Weak family: \`${weak.scope}\` in \`${weak.suite}\` (pitch \`${weak.avgPitchMatchScore ?? "n/a"}\`, feel \`${weak.avgMusicFeelScore ?? "n/a"}\`, warn \`${weak.warn ?? 0}\`)`,
      );
    }
  }
  lines.push("");
  lines.push("## What to do next");
  lines.push("");
  for (const item of report.next) {
    lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

function tail(input: string, maxLines = 12, maxChars = 2000): string {
  const lines = input.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "";
  const joined = lines.slice(-maxLines).join("\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}…`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveAudioPythonCommand(): string {
  const configuredPython =
    process.env.AUDIO_ACCEPTANCE_PYTHON ?? process.env.AUDIO_WORKER_PYTHON;
  if (configuredPython) return configuredPython;

  const localVenvPython = resolve(workerRoot, ".venv/bin/python");
  try {
    accessSync(localVenvPython, constants.X_OK);
    return localVenvPython;
  } catch {
    return process.env.PYTHON ?? "python";
  }
}

await main();
