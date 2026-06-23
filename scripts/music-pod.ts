#!/usr/bin/env bun
/**
 * Manual lifecycle for the long-lived Magenta music *pod* on RunPod — the warm
 * alternative to the scale-to-zero serverless endpoint.
 *
 * The pod runs the same image as serverless (workers/music-engine) but in the
 * "server" role (MUSIC_ENGINE_ROLE=server → FastAPI on :8002), reachable at a
 * stable URL `https://<podId>-8002.proxy.runpod.net`. The app talks to it in
 * http mode via MUSIC_WORKER_URL + MUSIC_WORKER_TOKEN (see music-worker.ts).
 *
 * Because it attaches the same network volume the serverless endpoint primes,
 * the ~4 GB model is already cached — a stopped→started pod is warm in seconds,
 * not the minutes a cold serverless worker costs.
 *
 *   bun run pod:create            # find-or-create the pod (starts it running)
 *   bun run pod:start             # resume a stopped pod, wait until healthy
 *   bun run pod:stop              # stop it (frees the GPU; keeps the disk)
 *   bun run pod:status            # show desiredStatus + /health + URL
 *
 * Flags / env:
 *   VERCEL=1     sync MUSIC_WORKER_URL/TOKEN + explicit MUSIC_ENGINE_MODE=http
 *   SWITCH=1     (with stop) flip MUSIC_ENGINE_MODE back to serverless
 *   RUNPOD_API_KEY (required) · RUNPOD_GPU_TYPE_ID · MUSIC_WORKER_TOKEN
 *   MURMUR_MUSIC_IMAGE · RUNPOD_NETWORK_VOLUME_ID · RUNPOD_REGISTRY_AUTH_ID
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(ROOT, ".env.workers.local") }); // MUSIC_WORKER_TOKEN
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });

const ENV_FILE = resolve(ROOT, ".env.music-pod");
const POD_NAME = "murmur-music-pod";
const HTTP_PORT = 8002;
const CONTAINER_DISK_GB = 30;
const READY_TIMEOUT_MS = 5 * 60_000;

const IMAGE =
  process.env.MURMUR_MUSIC_IMAGE?.trim() ||
  "ghcr.io/p-to-q/murmur-music-engine:latest";
const MODEL = process.env.MAGENTA_MODEL?.trim() || "mrt2_base";

// A5000 first: cheapest 24 GB card, enough for mrt2_base under JAX. Fallbacks
// stay on cards available in the network volume's (secure) data center.
// MUSIC_POD_GPU_TYPE_ID overrides — deliberately NOT RUNPOD_GPU_TYPE_ID, which
// is the serverless deploy's preference and would otherwise hijack the pod.
const GPU_CANDIDATES = [
  process.env.MUSIC_POD_GPU_TYPE_ID?.trim(),
  "NVIDIA RTX A5000",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA L4",
  "NVIDIA A40",
].filter(Boolean) as string[];

type Pod = { id: string; name: string; desiredStatus?: string };
type NetworkVolume = { id: string; name: string; dataCenterId: string };

async function main() {
  const command = (process.argv[2] || "status").toLowerCase();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (!apiKey) die("RUNPOD_API_KEY is required (https://www.runpod.io/console/user/settings).");

  switch (command) {
    case "create":
      return cmdCreate(apiKey);
    case "start":
    case "resume":
      return cmdStart(apiKey);
    case "stop":
      return cmdStop(apiKey);
    case "status":
      return cmdStatus(apiKey);
    default:
      die(`Unknown command "${command}". Use: create | start | stop | status.`);
  }
}

// ── Commands ───────────────────────────────────────────────────────────

async function cmdCreate(apiKey: string) {
  const existing = await findPod(apiKey);
  if (existing) {
    console.log(`Pod already exists: ${existing.id} (status=${existing.desiredStatus}).`);
    if (existing.desiredStatus !== "RUNNING") {
      console.log("Resuming it…");
      await resumePod(apiKey, existing.id);
    }
    return finishUp(apiKey, existing.id);
  }

  const volume = await resolveVolume(apiKey);
  const token = ensureWorkerToken();
  const env = podEnv(token);
  const registryAuthId = process.env.RUNPOD_REGISTRY_AUTH_ID?.trim();

  let lastError: unknown = null;
  for (const gpuTypeId of GPU_CANDIDATES) {
    console.log(`Deploying ${POD_NAME} on "${gpuTypeId}" in ${volume.dataCenterId}…`);
    try {
      const pod = await deployPod(apiKey, { gpuTypeId, volume, env, registryAuthId });
      console.log(`Pod deployed: ${pod.id}`);
      return finishUp(apiKey, pod.id);
    } catch (error) {
      lastError = error;
      console.warn(`  ✗ ${gpuTypeId}: ${error instanceof Error ? error.message : error}`);
    }
  }
  die(`Could not deploy on any GPU candidate. Last error: ${String(lastError)}`);
}

async function cmdStart(apiKey: string) {
  const pod = await requirePod(apiKey);
  if (pod.desiredStatus === "RUNNING") {
    console.log(`Pod ${pod.id} is already RUNNING.`);
  } else {
    console.log(`Resuming pod ${pod.id}…`);
    await resumePod(apiKey, pod.id);
  }
  return finishUp(apiKey, pod.id);
}

async function cmdStop(apiKey: string) {
  const pod = await requirePod(apiKey);
  console.log(`Stopping pod ${pod.id} (GPU released, disk kept)…`);
  await graphql(apiKey, `mutation($input: PodStopInput!){ podStop(input:$input){ id desiredStatus } }`, {
    input: { podId: pod.id },
  });
  console.log("Stopped. You stop paying for the GPU; the network volume persists the model.");
  if (envFlag("VERCEL") && envFlag("SWITCH")) {
    await syncVercel({ mode: "serverless" });
    console.log("Prod switched back to serverless (MUSIC_ENGINE_MODE=serverless).");
  } else {
    console.log("Prod transport unchanged. Re-run with VERCEL=1 SWITCH=1 to fail back to serverless.");
  }
}

async function cmdStatus(apiKey: string) {
  const pod = await findPod(apiKey);
  if (!pod) {
    console.log(`No pod named "${POD_NAME}". Create one with: bun run pod:create`);
    return;
  }
  const url = proxyUrl(pod.id);
  console.log(`Pod:    ${pod.id} (${pod.name})`);
  console.log(`Status: ${pod.desiredStatus}`);
  console.log(`URL:    ${url}`);
  if (pod.desiredStatus === "RUNNING") {
    const health = await probeHealth(url);
    console.log(`Health: ${health ?? "(no response yet — model may still be loading)"}`);
  }
}

// ── Shared steps ───────────────────────────────────────────────────────

/** After create/start: wait until healthy, persist, optionally sync Vercel. */
async function finishUp(apiKey: string, podId: string) {
  const url = proxyUrl(podId);
  console.log(`Waiting for the worker to answer at ${url}/health …`);
  const ready = await waitForHealth(url, READY_TIMEOUT_MS);
  if (ready) {
    console.log(`✓ Worker healthy: ${ready}`);
  } else {
    console.warn(
      "Worker did not report healthy within the budget. It may still be pulling the image or loading the model — re-check with `bun run pod:status`.",
    );
  }
  persistEnv(podId, url);
  if (envFlag("VERCEL")) {
    await syncVercel({ mode: "http", url, token: ensureWorkerToken() });
    console.log("Prod switched to the pod (MUSIC_ENGINE_MODE=http).");
    console.log("Serverless env may remain present for failback; explicit mode=http now selects the pod.");
    console.log("Verify with: curl -sS https://murmur.ptoq.io/api/music/health");
  } else {
    console.log("\nManual prod env (or re-run with VERCEL=1 to push automatically):");
    console.log(`  MUSIC_ENGINE_MODE=http`);
    console.log(`  MUSIC_WORKER_URL=${url}`);
    ensureWorkerToken();
    console.log("  MUSIC_WORKER_TOKEN=<redacted; stored in .env.workers.local>");
  }
}

async function deployPod(
  apiKey: string,
  opts: {
    gpuTypeId: string;
    volume: NetworkVolume;
    env: Array<{ key: string; value: string }>;
    registryAuthId?: string;
  },
): Promise<Pod> {
  const input: Record<string, unknown> = {
    cloudType: "SECURE",
    name: POD_NAME,
    imageName: IMAGE,
    gpuTypeId: opts.gpuTypeId,
    gpuCount: 1,
    containerDiskInGb: CONTAINER_DISK_GB,
    volumeInGb: 0,
    volumeMountPath: "/runpod-volume",
    ports: `${HTTP_PORT}/http`,
    networkVolumeId: opts.volume.id,
    dataCenterId: opts.volume.dataCenterId,
    env: opts.env,
  };
  if (opts.registryAuthId) input.containerRegistryAuthId = opts.registryAuthId;

  const data = await graphql<{ podFindAndDeployOnDemand: Pod | null }>(
    apiKey,
    `mutation($input: PodFindAndDeployOnDemandInput!){
       podFindAndDeployOnDemand(input:$input){ id name desiredStatus }
     }`,
    { input },
  );
  if (!data.podFindAndDeployOnDemand) {
    throw new Error("RunPod returned no pod (no capacity for this GPU in the volume's DC).");
  }
  return data.podFindAndDeployOnDemand;
}

async function resumePod(apiKey: string, podId: string) {
  await graphql(apiKey, `mutation($input: PodResumeInput!){ podResume(input:$input){ id desiredStatus } }`, {
    input: { podId, gpuCount: 1 },
  });
}

function podEnv(token: string): Array<{ key: string; value: string }> {
  const env: Record<string, string> = {
    MUSIC_ENGINE_ROLE: "server",
    MUSIC_ENGINE_PORT: String(HTTP_PORT),
    MAGENTA_BACKEND: "jax",
    MAGENTA_MODEL: MODEL,
    MUSIC_ENGINE_PRELOAD: "1",
    MUSIC_WORKER_REQUIRE_AUTH: "1",
    MUSIC_WORKER_TOKEN: token,
  };
  const cfgNotes = process.env.MAGENTA_CFG_NOTES?.trim();
  if (cfgNotes) env.MAGENTA_CFG_NOTES = cfgNotes;
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

// ── RunPod GraphQL ─────────────────────────────────────────────────────

async function graphql<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.map((e) => e.message).join("; ") || `RunPod GraphQL HTTP ${res.status}`);
  }
  if (!body.data) throw new Error("RunPod GraphQL returned no data");
  return body.data;
}

async function findPod(apiKey: string): Promise<Pod | null> {
  const data = await graphql<{ myself: { pods: Pod[] } }>(
    apiKey,
    `query { myself { pods { id name desiredStatus } } }`,
  );
  return data.myself.pods.find((p) => p.name === POD_NAME) ?? null;
}

async function requirePod(apiKey: string): Promise<Pod> {
  const pod = await findPod(apiKey);
  if (!pod) die(`No pod named "${POD_NAME}". Create one first: bun run pod:create`);
  return pod;
}

async function resolveVolume(apiKey: string): Promise<NetworkVolume> {
  const data = await graphql<{ myself: { networkVolumes: NetworkVolume[] } }>(
    apiKey,
    `query { myself { networkVolumes { id name dataCenterId } } }`,
  );
  const volumes = data.myself.networkVolumes;
  const wanted = process.env.RUNPOD_NETWORK_VOLUME_ID?.trim();
  const volume = wanted
    ? volumes.find((v) => v.id === wanted)
    : volumes.find((v) => v.name === "murmur-music-vol") ?? volumes[0];
  if (!volume) {
    die("No network volume found. Deploy serverless first (it creates murmur-music-vol) or set RUNPOD_NETWORK_VOLUME_ID.");
  }
  return volume;
}

// ── Health, persistence, Vercel ────────────────────────────────────────

function proxyUrl(podId: string): string {
  return `https://${podId}-${HTTP_PORT}.proxy.runpod.net`;
}

async function probeHealth(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return `status=${body.status} loaded=${body.loaded} loading=${body.loading}`;
  } catch {
    return null;
  }
}

async function waitForHealth(url: string, budgetMs: number): Promise<string | null> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const health = await probeHealth(url);
    // /health answers as soon as uvicorn is up; "loaded=true" means the model
    // finished warming and the first real clip won't pay the load.
    if (health && health.includes("loaded=true")) return health;
    process.stdout.write(".");
    await sleep(5_000);
  }
  process.stdout.write("\n");
  return null;
}

function ensureWorkerToken(): string {
  const existing = process.env.MUSIC_WORKER_TOKEN?.trim();
  if (existing) return existing;
  // Mint one and stash it where serve-workers-public.sh keeps its tokens so the
  // local dev worker and the pod share a secret.
  const token = randomBytes(24).toString("hex");
  const file = resolve(ROOT, ".env.workers.local");
  const line = `MUSIC_WORKER_TOKEN=${token}\n`;
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    writeFileSync(file, /^MUSIC_WORKER_TOKEN=/m.test(text)
      ? text.replace(/^MUSIC_WORKER_TOKEN=.*$/m, `MUSIC_WORKER_TOKEN=${token}`)
      : text + line);
  } else {
    writeFileSync(file, line);
  }
  process.env.MUSIC_WORKER_TOKEN = token;
  console.log(`Minted MUSIC_WORKER_TOKEN → .env.workers.local`);
  return token;
}

function persistEnv(podId: string, url: string) {
  const lines = [
    `# Written by scripts/music-pod.ts — ${new Date().toISOString()}`,
    `MUSIC_POD_ID=${podId}`,
    `MUSIC_WORKER_URL=${url}`,
    `MUSIC_ENGINE_MODE=http`,
  ];
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
  console.log(`Saved ${ENV_FILE}`);
}

async function syncVercel(opts: { mode: "http" | "serverless"; url?: string; token?: string }) {
  console.log(`Syncing Vercel production env (MUSIC_ENGINE_MODE=${opts.mode})…`);
  const pathEnv = `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`;
  const pairs: Array<[string, string]> = [["MUSIC_ENGINE_MODE", opts.mode]];
  if (opts.mode === "http") {
    if (opts.url) pairs.push(["MUSIC_WORKER_URL", opts.url]);
    if (opts.token) pairs.push(["MUSIC_WORKER_TOKEN", opts.token]);
  }
  for (const [key, value] of pairs) {
    await runShell(
      `printf '%s' '${value.replace(/'/g, `'\\''`)}' | vercel env add ${key} production --force`,
      pathEnv,
    );
  }
  console.log("Redeploying production…");
  await runShell("vercel --prod --yes", pathEnv);
}

// ── Small utilities ────────────────────────────────────────────────────

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function runShell(command: string, pathEnv: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: ROOT,
      env: { ...process.env, PATH: pathEnv },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`shell exited ${code ?? "?"}: ${command}`)),
    );
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
