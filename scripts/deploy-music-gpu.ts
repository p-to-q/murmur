#!/usr/bin/env bun
/**
 * One-click Magenta GPU deploy on RunPod + Vercel sync.
 *
 * Requires:
 *   RUNPOD_API_KEY   — https://www.runpod.io/console/user/settings
 *
 * Optional:
 *   MUSIC_WORKER_TOKEN — reuse existing bearer token (generated if absent)
 *   MURMUR_MUSIC_IMAGE   — override container image
 *   RUNPOD_GPU_TYPE_ID   — e.g. "NVIDIA GeForce RTX 4090"
 *   VERCEL=1             — skip vercel env sync when unset/false
 *
 * Usage:
 *   bun run deploy:music-gpu
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });
const ENV_FILE = resolve(ROOT, ".env.workers.cloud");
const POD_NAME = "murmur-music-gpu";
const SERVICE_PORT = 8002;
const DEFAULT_IMAGE =
  process.env.MURMUR_MUSIC_IMAGE?.trim() ||
  "ghcr.io/p-to-q/murmur-music-engine:latest";
const GPU_CANDIDATES = [
  process.env.RUNPOD_GPU_TYPE_ID?.trim(),
  "NVIDIA L4",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX A5000",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA RTX A6000",
].filter(Boolean) as string[];

type RunpodResponse<T> = { data?: T; errors?: Array<{ message: string }> };

type PodSummary = {
  id: string;
  name: string;
  desiredStatus: string;
  imageName: string;
};

async function main() {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      [
        "RUNPOD_API_KEY is required.",
        "Create one at https://www.runpod.io/console/user/settings",
        "Then run:",
        "  RUNPOD_API_KEY=rpa_… bun run deploy:music-gpu",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const { token, tokenWasNew } = loadOrCreateToken();
  console.log(`Using MUSIC_WORKER_TOKEN (${tokenWasNew ? "new" : "existing"}).`);

  let pod = await findPod(apiKey, POD_NAME);
  if (pod && pod.desiredStatus === "EXITED") {
    console.log(`Resuming stopped pod ${pod.id}…`);
    await runpodMutation(apiKey, `mutation($id: String!) { podResume(input: { podId: $id }) { id desiredStatus } }`, {
      id: pod.id,
    });
    pod = await waitForPod(apiKey, pod.id);
  }

  if (!pod) {
    console.log("No running music GPU pod — deploying a new one on RunPod…");
    const gpuTypeId = await pickGpuType(apiKey);
    console.log(`Selected GPU type: ${gpuTypeId}`);
    const created = await deployPod(apiKey, gpuTypeId, token);
    pod = await waitForPod(apiKey, created.id);
  }

  const publicUrl = runpodProxyUrl(pod.id);
  console.log(`RunPod proxy URL: ${publicUrl}`);

  console.log("Waiting for /health (first boot may download ~4 GB of model weights)…");
  const healthy = await waitForHealth(publicUrl, token, 20 * 60_000);
  if (!healthy) {
    console.error(
      "Pod is up but /health never returned ok. Check RunPod console logs, then retry.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("Music worker healthy on GPU.");

  persistEnv(publicUrl, token);

  const syncVercel = shouldSyncVercel();
  if (syncVercel) {
    await syncVercelEnv(publicUrl, token);
  } else {
    console.log("Skipped Vercel sync — rerun with VERCEL=1 after `vercel login`.");
    console.log(`Manual: MUSIC_WORKER_URL=${publicUrl}`);
  }

  console.log("\nDone. Production will use cloud Magenta (JAX/CUDA) instead of local MLX.");
  console.log(`Health: ${publicUrl}/health`);
}

function loadOrCreateToken(): { token: string; tokenWasNew: boolean } {
  if (process.env.MUSIC_WORKER_TOKEN?.trim()) {
    return { token: process.env.MUSIC_WORKER_TOKEN.trim(), tokenWasNew: false };
  }
  if (existsSync(ENV_FILE)) {
    const parsed = parseEnvFile(readFileSync(ENV_FILE, "utf8"));
    if (parsed.MUSIC_WORKER_TOKEN) {
      return { token: parsed.MUSIC_WORKER_TOKEN, tokenWasNew: false };
    }
  }
  const token = randomBytes(24).toString("hex");
  return { token, tokenWasNew: true };
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function persistEnv(url: string, token: string) {
  const lines = [
    `# Written by scripts/deploy-music-gpu.ts — ${new Date().toISOString()}`,
    `MUSIC_WORKER_URL=${url}`,
    `MUSIC_WORKER_TOKEN=${token}`,
    `MAGENTA_BACKEND=jax`,
  ];
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
  console.log(`Saved ${ENV_FILE}`);
}

function shouldSyncVercel(): boolean {
  const flag = process.env.VERCEL?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  return false;
}

async function runpodQuery<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as RunpodResponse<T>;
  if (!res.ok || body.errors?.length) {
    throw new Error(
      body.errors?.map((e) => e.message).join("; ") ||
        `RunPod GraphQL HTTP ${res.status}`,
    );
  }
  if (!body.data) throw new Error("RunPod GraphQL returned no data");
  return body.data;
}

async function runpodMutation<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return runpodQuery<T>(apiKey, query, variables);
}

async function findPod(apiKey: string, name: string): Promise<PodSummary | null> {
  const data = await runpodQuery<{ myself: { pods: PodSummary[] } }>(
    apiKey,
    `query {
      myself {
        pods {
          id
          name
          desiredStatus
          imageName
        }
      }
    }`,
  );
  const matches = data.myself.pods.filter((p) => p.name === name);
  const preferred =
    matches.find((p) => p.desiredStatus === "RUNNING") ??
    matches.find((p) => p.desiredStatus !== "TERMINATED") ??
    matches[0];
  return preferred ?? null;
}

async function waitForPod(apiKey: string, podId: string): Promise<PodSummary> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const data = await runpodQuery<{ pod: PodSummary | null }>(
      apiKey,
      `query($id: String!) {
        pod(input: { podId: $id }) {
          id
          name
          desiredStatus
          imageName
        }
      }`,
      { id: podId },
    );
    const pod = data.pod;
    if (pod && pod.desiredStatus === "RUNNING") {
      return pod;
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  throw new Error(`Pod ${podId} did not reach RUNNING within 10 minutes`);
}

async function pickGpuType(apiKey: string): Promise<string> {
  const data = await runpodQuery<{
    gpuTypes: Array<{ id: string; displayName: string; memoryInGb: number }>;
  }>(
    apiKey,
    `query {
      gpuTypes {
        id
        displayName
        memoryInGb
      }
    }`,
  );

  for (const candidate of GPU_CANDIDATES) {
    const hit = data.gpuTypes.find(
      (g) => g.id === candidate || g.displayName === candidate,
    );
    if (hit) return hit.id;
  }

  const fallback = data.gpuTypes.find((g) => g.memoryInGb >= 16);
  if (fallback) return fallback.id;
  throw new Error("No suitable RunPod GPU type found. Set RUNPOD_GPU_TYPE_ID explicitly.");
}

async function deployPod(
  apiKey: string,
  gpuTypeId: string,
  token: string,
): Promise<{ id: string }> {
  const data = await runpodMutation<{
    podFindAndDeployOnDemand: { id: string; desiredStatus: string };
  }>(
    apiKey,
    `mutation($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        desiredStatus
      }
    }`,
    {
      input: {
        cloudType: "SECURE",
        gpuCount: 1,
        gpuTypeId,
        name: POD_NAME,
        imageName: DEFAULT_IMAGE,
        containerDiskInGb: 30,
        volumeInGb: 40,
        volumeMountPath: "/root/Documents/Magenta",
        minVcpuCount: 4,
        minMemoryInGb: 16,
        ports: `${SERVICE_PORT}/http`,
        env: [
          { key: "MUSIC_WORKER_TOKEN", value: token },
          { key: "MAGENTA_BACKEND", value: "jax" },
          { key: "MAGENTA_MODEL", value: process.env.MAGENTA_MODEL?.trim() || "mrt2_base" },
          { key: "MUSIC_ENGINE_PRELOAD", value: "1" },
          { key: "PORT", value: String(SERVICE_PORT) },
        ],
      },
    },
  );
  return data.podFindAndDeployOnDemand;
}

function runpodProxyUrl(podId: string): string {
  return `https://${podId}-${SERVICE_PORT}.proxy.runpod.net`;
}

async function waitForHealth(
  baseUrl: string,
  token: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          status?: string;
          loaded?: boolean;
          loading?: boolean;
        };
        if (body.status === "ok" || body.loaded || body.loading) return true;
      }
    } catch {
      // pod still booting / model downloading
    }
    process.stdout.write(".");
    await sleep(10_000);
  }
  return false;
}

async function syncVercelEnv(url: string, token: string) {
  console.log("Syncing Vercel production env (MUSIC_WORKER_URL + TOKEN)…");
  for (const [key, value] of [
    ["MUSIC_WORKER_URL", url],
    ["MUSIC_WORKER_TOKEN", token],
  ] as const) {
    await runCommand("vercel", ["env", "add", key, "production", "--force"], {
      input: value,
      cwd: ROOT,
    });
  }
  console.log("Redeploying production…");
  await runCommand("vercel", ["--prod", "--yes"], { cwd: ROOT });
}

function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; input?: string } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
