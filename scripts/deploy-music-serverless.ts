#!/usr/bin/env bun
/**
 * One-click Magenta deploy on RunPod Serverless + Vercel sync.
 *
 * Creates (or updates) a scale-to-zero serverless endpoint that runs the
 * music-engine handler (workers/music-engine/handler.py). The ~4 GB model lives
 * on a network volume so it downloads once and persists across cold starts.
 *
 * Requires:
 *   RUNPOD_API_KEY   — https://www.runpod.io/console/user/settings
 *
 * Optional:
 *   MURMUR_MUSIC_IMAGE        — override container image (default ghcr public image)
 *   MAGENTA_MODEL             — mrt2_base (default) | mrt2_small
 *   MAGENTA_CFG_NOTES         — melody CFG scale passed to the worker
 *   RUNPOD_DATA_CENTER_ID     — DC for the network volume (default EU-RO-1)
 *   RUNPOD_NETWORK_VOLUME_ID  — reuse an existing volume instead of creating one
 *   RUNPOD_GPU_TYPE_ID        — preferred GPU, e.g. "NVIDIA L4"
 *   RUNPOD_WORKERS_MAX        — max concurrent workers (default 2)
 *   RUNPOD_IDLE_TIMEOUT       — seconds a worker stays warm when idle (default 120)
 *   RUNPOD_REGISTRY_AUTH_ID   — only if the image is private (CI makes it public)
 *   WARMUP=0                  — skip the post-deploy warm-up job
 *   VERCEL=1                  — vercel env add + redeploy (default off)
 *
 * Usage:
 *   RUNPOD_API_KEY=rpa_… VERCEL=1 bun run deploy:music-serverless
 */

import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });

const ENV_FILE = resolve(ROOT, ".env.workers.cloud");
const REST_BASE = "https://rest.runpod.io/v1";
const RUN_BASE = "https://api.runpod.ai/v2";

const VOLUME_NAME = "murmur-music-vol";
const VOLUME_GB = 50;
const TEMPLATE_NAME = "murmur-music-serverless";
const ENDPOINT_NAME = "murmur-music-serverless";
const DEFAULT_DATA_CENTER = "EU-RO-1";
const REGISTRY_AUTH_NAME = "murmur-ghcr";

const MODEL = process.env.MAGENTA_MODEL?.trim() || "mrt2_base";
const IMAGE =
  process.env.MURMUR_MUSIC_IMAGE?.trim() ||
  "ghcr.io/p-to-q/murmur-music-engine:latest";
const WORKERS_MAX = clampInt(process.env.RUNPOD_WORKERS_MAX, 2, 1, 10);
const IDLE_TIMEOUT = clampInt(process.env.RUNPOD_IDLE_TIMEOUT, 120, 5, 3600);
const EXECUTION_TIMEOUT_MS = 180_000;

const GPU_CANDIDATES = [
  process.env.RUNPOD_GPU_TYPE_ID?.trim(),
  "NVIDIA L4",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX A5000",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA RTX A6000",
].filter(Boolean) as string[];

type NetworkVolume = { id: string; name: string; size: number; dataCenterId: string };
type Template = { id: string; name: string };
type Endpoint = { id: string; name: string };

async function main() {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      [
        "RUNPOD_API_KEY is required.",
        "Create one at https://www.runpod.io/console/user/settings",
        "Then run:",
        "  RUNPOD_API_KEY=rpa_… bun run deploy:music-serverless",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Image: ${IMAGE}`);
  console.log(`Model: ${MODEL} · workersMax=${WORKERS_MAX} · idleTimeout=${IDLE_TIMEOUT}s · scale-to-zero + FlashBoot`);

  const registryAuthId = await ensureRegistryAuth(apiKey);
  if (registryAuthId) {
    console.log(`Registry auth: ${registryAuthId.slice(0, 8)}… (private ghcr image)`);
  } else {
    console.log("No registry auth resolved — assuming the image is anonymously pullable.");
  }

  const volume = await ensureNetworkVolume(apiKey);
  console.log(`Network volume: ${volume.id} (${volume.name}) in ${volume.dataCenterId}`);

  const templateId = await ensureTemplate(apiKey, registryAuthId);
  console.log(`Template: ${templateId} (${TEMPLATE_NAME})`);

  const endpointId = await ensureEndpoint(apiKey, templateId, volume);
  console.log(`Serverless endpoint: ${endpointId} (${ENDPOINT_NAME})`);
  console.log(`Invoke URL: ${RUN_BASE}/${endpointId}/run`);

  if (shouldWarmUp()) {
    console.log(
      "Warming up — first cold start pulls the image and downloads the ~4 GB model onto the volume (allow up to ~20 min)…",
    );
    const ok = await warmUp(apiKey, endpointId);
    if (ok) {
      console.log("Warm-up job completed — model cached on the volume, endpoint healthy.");
    } else {
      console.warn(
        "Warm-up did not complete in time. The endpoint is created; the model will download on the first real request instead. Check the RunPod console logs.",
      );
    }
  } else {
    console.log("Skipped warm-up (WARMUP=0).");
  }

  persistEnv(endpointId, volume.id);

  if (shouldSyncVercel()) {
    await syncVercelEnv(apiKey, endpointId);
  } else {
    console.log("Skipped Vercel sync — rerun with VERCEL=1 after `vercel login`.");
    console.log("Manual prod env:");
    console.log(`  RUNPOD_SERVERLESS_ENDPOINT_ID=${endpointId}`);
    console.log("  RUNPOD_API_KEY=<your key>");
  }

  console.log("\nDone. Production music generation now runs on RunPod Serverless (JAX/CUDA).");
  console.log(`Health: ${RUN_BASE}/${endpointId}/health (Authorization: Bearer <RUNPOD_API_KEY>)`);
}

// ── RunPod REST + run helpers ──────────────────────────────────────────

async function rest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${REST_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const detail =
      (json as { error?: string; message?: string } | null)?.error ||
      (json as { error?: string; message?: string } | null)?.message ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(`RunPod REST ${method} ${path} → ${res.status}: ${detail}`);
  }
  return json as T;
}

type RegistryCred = { id: string; name: string };

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
    throw new Error(
      body.errors?.map((e) => e.message).join("; ") || `RunPod GraphQL HTTP ${res.status}`,
    );
  }
  if (!body.data) throw new Error("RunPod GraphQL returned no data");
  return body.data;
}

function ghcrCredentials(): { username: string; password: string } | null {
  const username = process.env.GHCR_USERNAME?.trim() || process.env.GITHUB_USERNAME?.trim();
  const password = process.env.GHCR_TOKEN?.trim() || process.env.GITHUB_PACKAGES_TOKEN?.trim();
  if (!username || !password) return null;
  return { username, password };
}

/**
 * Resolve a RunPod container-registry credential id for the private ghcr image
 * (the p-to-q org forces packages private, so the serverless endpoint must pull
 * with auth). Order: explicit RUNPOD_REGISTRY_AUTH_ID → reuse existing
 * "murmur-ghcr" cred → register one from GHCR_USERNAME+GHCR_TOKEN. Returns
 * undefined only if no creds exist (then RunPod attempts an anonymous pull).
 */
async function ensureRegistryAuth(apiKey: string): Promise<string | undefined> {
  const explicit = process.env.RUNPOD_REGISTRY_AUTH_ID?.trim();
  if (explicit) return explicit;

  const ghcr = ghcrCredentials();
  const data = await graphql<{ myself: { containerRegistryCreds: RegistryCred[] } }>(
    apiKey,
    `query { myself { containerRegistryCreds { id name } } }`,
  );
  const existing = data.myself.containerRegistryCreds.find((c) => c.name === REGISTRY_AUTH_NAME);
  if (existing) {
    if (ghcr) console.log(`Reusing RunPod registry auth "${REGISTRY_AUTH_NAME}".`);
    return existing.id;
  }
  if (!ghcr) return undefined;

  console.log(`Registering RunPod registry auth "${REGISTRY_AUTH_NAME}" for ghcr.io…`);
  const saved = await graphql<{ saveRegistryAuth: { id: string } }>(
    apiKey,
    `mutation($input: SaveRegistryAuthInput!) { saveRegistryAuth(input: $input) { id name } }`,
    { input: { name: REGISTRY_AUTH_NAME, username: ghcr.username, password: ghcr.password } },
  );
  return saved.saveRegistryAuth.id;
}

async function ensureNetworkVolume(apiKey: string): Promise<NetworkVolume> {
  const explicit = process.env.RUNPOD_NETWORK_VOLUME_ID?.trim();
  const volumes = await rest<NetworkVolume[]>(apiKey, "GET", "/networkvolumes");

  if (explicit) {
    const found = volumes.find((v) => v.id === explicit);
    if (found) return found;
    throw new Error(
      `RUNPOD_NETWORK_VOLUME_ID=${explicit} not found in your account's network volumes.`,
    );
  }

  const existing = volumes.find((v) => v.name === VOLUME_NAME);
  if (existing) return existing;

  const dataCenterId = process.env.RUNPOD_DATA_CENTER_ID?.trim() || DEFAULT_DATA_CENTER;
  console.log(`Creating ${VOLUME_GB} GB network volume "${VOLUME_NAME}" in ${dataCenterId}…`);
  return rest<NetworkVolume>(apiKey, "POST", "/networkvolumes", {
    name: VOLUME_NAME,
    size: VOLUME_GB,
    dataCenterId,
  });
}

function templateBody(registryAuthId?: string) {
  const env: Record<string, string> = {
    MAGENTA_BACKEND: "jax",
    MAGENTA_MODEL: MODEL,
    MUSIC_ENGINE_PRELOAD: "1",
  };
  const cfgNotes = process.env.MAGENTA_CFG_NOTES?.trim();
  if (cfgNotes) env.MAGENTA_CFG_NOTES = cfgNotes;

  const body: Record<string, unknown> = {
    name: TEMPLATE_NAME,
    imageName: IMAGE,
    isServerless: true,
    containerDiskInGb: 30,
    env,
  };
  if (registryAuthId) body.containerRegistryAuthId = registryAuthId;
  return body;
}

async function ensureTemplate(apiKey: string, registryAuthId?: string): Promise<string> {
  const templates = await rest<Template[]>(apiKey, "GET", "/templates");
  const existing = templates.find((t) => t.name === TEMPLATE_NAME);
  if (existing) {
    // Reuse as-is. RunPod's PATCH /templates rejects the create body ("extra
    // input keys"), and re-runs need no change: the image is :latest (cold
    // workers always pull it) and env is already set. To change image/env,
    // delete the template in the console and redeploy.
    console.log(`Reusing existing template ${existing.id}.`);
    return existing.id;
  }
  const created = await rest<Template>(apiKey, "POST", "/templates", templateBody(registryAuthId));
  return created.id;
}

function endpointBody(templateId: string, volume: NetworkVolume) {
  return {
    templateId,
    name: ENDPOINT_NAME,
    computeType: "GPU",
    gpuTypeIds: GPU_CANDIDATES,
    gpuCount: 1,
    dataCenterIds: [volume.dataCenterId],
    networkVolumeId: volume.id,
    workersMin: 0,
    workersMax: WORKERS_MAX,
    idleTimeout: IDLE_TIMEOUT,
    executionTimeoutMs: EXECUTION_TIMEOUT_MS,
    flashboot: true,
    scalerType: "QUEUE_DELAY",
    scalerValue: 4,
  };
}

async function ensureEndpoint(
  apiKey: string,
  templateId: string,
  volume: NetworkVolume,
): Promise<string> {
  const endpoints = await rest<Endpoint[]>(apiKey, "GET", "/endpoints");
  const existing = endpoints.find((e) => e.name === ENDPOINT_NAME);
  if (existing) {
    // Reuse as-is (same reason as the template: PATCH rejects the create body).
    // To change GPU/scaling, edit the endpoint in the console or delete it first.
    console.log(`Reusing existing endpoint ${existing.id}.`);
    return existing.id;
  }
  const created = await rest<Endpoint>(apiKey, "POST", "/endpoints", endpointBody(templateId, volume));
  return created.id;
}

async function warmUp(apiKey: string, endpointId: string): Promise<boolean> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  let jobId: string;
  try {
    const submit = await fetch(`${RUN_BASE}/${endpointId}/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: { prompt: "warm up the model", duration: 2 } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await submit.json()) as { id?: string; status?: string };
    if (!submit.ok || !body.id) {
      console.warn(`Warm-up submit failed: HTTP ${submit.status}`);
      return false;
    }
    if ((body.status ?? "").toUpperCase() === "COMPLETED") return true;
    jobId = body.id;
  } catch (error) {
    console.warn(`Warm-up submit error: ${error instanceof Error ? error.message : error}`);
    return false;
  }

  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const res = await fetch(`${RUN_BASE}/${endpointId}/status/${jobId}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { status?: string };
      const status = (body.status ?? "").toUpperCase();
      if (status === "COMPLETED") return true;
      if (status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT") {
        console.warn(`Warm-up job ${status}.`);
        return false;
      }
    } catch {
      // transient — keep polling
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return false;
}

// ── Persistence + Vercel ───────────────────────────────────────────────

function persistEnv(endpointId: string, volumeId: string) {
  const lines = [
    `# Written by scripts/deploy-music-serverless.ts — ${new Date().toISOString()}`,
    `RUNPOD_SERVERLESS_ENDPOINT_ID=${endpointId}`,
    `RUNPOD_NETWORK_VOLUME_ID=${volumeId}`,
    `MAGENTA_BACKEND=jax`,
  ];
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
  console.log(`Saved ${ENV_FILE}`);
}

async function syncVercelEnv(apiKey: string, endpointId: string) {
  console.log("Syncing Vercel production env (RunPod serverless music engine)…");
  const pathEnv = `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`;
  for (const [key, value] of [
    ["RUNPOD_SERVERLESS_ENDPOINT_ID", endpointId],
    ["RUNPOD_API_KEY", apiKey],
    ["MUSIC_ENGINE_MODE", "serverless"],
  ] as const) {
    await runShell(
      `printf '%s' '${value.replace(/'/g, `'\\''`)}' | vercel env add ${key} production --force`,
      { cwd: ROOT, pathEnv },
    );
  }
  console.log("Redeploying production…");
  await runShell("vercel --prod --yes", { cwd: ROOT, pathEnv });
}

// ── Small utilities ────────────────────────────────────────────────────

function shouldSyncVercel(): boolean {
  const flag = process.env.VERCEL?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function shouldWarmUp(): boolean {
  const flag = process.env.WARMUP?.trim().toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "no");
}

function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function runShell(
  command: string,
  options: { cwd?: string; pathEnv?: string } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: options.cwd,
      env: { ...process.env, PATH: options.pathEnv ?? process.env.PATH },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`shell ${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

await main();
