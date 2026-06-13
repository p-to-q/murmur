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
 *   RUNPOD_REGISTRY_AUTH_ID — saved RunPod registry cred (ghcr.io private images)
 *   GHCR_USERNAME + GHCR_TOKEN — auto-register RunPod registry cred (PAT needs read:packages)
 *   RUNPOD_RESUME=1      — resume an EXITED pod instead of redeploying (keeps volume)
 *   VERCEL=1             — skip vercel env sync when unset/false
 *
 * Usage:
 *   bun run deploy:music-gpu
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });
const ENV_FILE = resolve(ROOT, ".env.workers.cloud");
const POD_NAME = "murmur-music-gpu";
const SERVICE_PORT = 8002;
const REGISTRY_AUTH_NAME = "murmur-ghcr";
const BOOTSTRAP_IMAGE = "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04";
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

type DeployPlan = {
  imageName: string;
  dockerArgs?: string;
  registryAuthId?: string;
  bootstrap: boolean;
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

  const registryAuthId = await ensureRegistryAuth(apiKey);
  const plan = await resolveDeployPlan(registryAuthId);
  if (plan.registryAuthId) {
    console.log(`Using RunPod registry auth for ghcr.io (${plan.registryAuthId.slice(0, 8)}…).`);
  }
  if (plan.bootstrap) {
    console.log(
      `GHCR image not anonymously pullable — bootstrapping from public ${BOOTSTRAP_IMAGE}.`,
    );
    console.log("First boot: pip install + ~4 GB model download (allow up to ~45 min).");
  } else {
    console.log(`Deploy image: ${plan.imageName}`);
  }

  let pod = await findPod(apiKey, POD_NAME);
  if (pod && pod.desiredStatus === "EXITED") {
    const shouldResume = shouldResumeExitedPod();
    if (shouldResume) {
      console.log(`Resuming stopped pod ${pod.id}…`);
      try {
        await runpodMutation(
          apiKey,
          `mutation($id: String!) { podResume(input: { podId: $id }) { id desiredStatus } }`,
          { id: pod.id },
        );
        pod = await waitForPod(apiKey, pod.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Resume failed (${msg}) — terminating and redeploying fresh…`);
        await terminatePod(apiKey, pod.id);
        pod = null;
      }
    } else {
      console.log(`Replacing EXITED pod ${pod.id} (redeploy picks up registry auth / fresh image)…`);
      await terminatePod(apiKey, pod.id);
      pod = null;
    }
  }

  if (!pod) {
    console.log("No running music GPU pod — deploying a new one on RunPod…");
    pod = await deployWithGpuFallback(apiKey, token, plan);
  }

  const publicUrl = runpodProxyUrl(pod.id);
  console.log(`RunPod proxy URL: ${publicUrl}`);

  const healthTimeoutMs = plan.bootstrap ? 45 * 60_000 : 20 * 60_000;
  console.log("Waiting for /health (first boot may download ~4 GB of model weights)…");
  const healthy = await waitForHealth(publicUrl, token, healthTimeoutMs);
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

function shouldResumeExitedPod(): boolean {
  const flag = process.env.RUNPOD_RESUME?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function needsRegistryAuth(imageName: string): boolean {
  return imageName.includes("ghcr.io/");
}

function ghcrCredentials(): { username: string; password: string } | null {
  const username =
    process.env.GHCR_USERNAME?.trim() ||
    process.env.GITHUB_USERNAME?.trim();
  const password =
    process.env.GHCR_TOKEN?.trim() ||
    process.env.GITHUB_PACKAGES_TOKEN?.trim();
  if (!username || !password) return null;
  return { username, password };
}

async function listRegistryCreds(
  apiKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await runpodQuery<{
    myself: { containerRegistryCreds: Array<{ id: string; name: string }> };
  }>(
    apiKey,
    `query {
      myself {
        containerRegistryCreds {
          id
          name
        }
      }
    }`,
  );
  return data.myself.containerRegistryCreds;
}

async function ensureRegistryAuth(apiKey: string): Promise<string | undefined> {
  const explicit = process.env.RUNPOD_REGISTRY_AUTH_ID?.trim();
  if (explicit) return explicit;

  if (!needsRegistryAuth(DEFAULT_IMAGE)) return undefined;

  const creds = await listRegistryCreds(apiKey);
  const existing = creds.find((c) => c.name === REGISTRY_AUTH_NAME);
  const ghcr = ghcrCredentials();
  if (!ghcr) {
    return existing?.id;
  }

  if (existing) {
    console.log(`RunPod registry auth "${REGISTRY_AUTH_NAME}" already exists — reusing.`);
    return existing.id;
  }

  console.log(`Registering RunPod registry auth "${REGISTRY_AUTH_NAME}" for ghcr.io…`);
  const data = await runpodMutation<{ saveRegistryAuth: { id: string } }>(
    apiKey,
    `mutation($input: SaveRegistryAuthInput!) {
      saveRegistryAuth(input: $input) {
        id
        name
      }
    }`,
    {
      input: {
        name: REGISTRY_AUTH_NAME,
        username: ghcr.username,
        password: ghcr.password,
      },
    },
  );
  return data.saveRegistryAuth.id;
}

function bootstrapDockerArgs(): string {
  const ref = process.env.MURMUR_GIT_REF?.trim() || "main";
  const scriptUrl = `https://raw.githubusercontent.com/p-to-q/murmur/${ref}/workers/music-engine/runpod-bootstrap.sh`;
  return `bash -lc 'curl -fsSL ${scriptUrl} | bash'`;
}

async function ghcrImagePullableAnonymously(imageName: string): Promise<boolean> {
  const match = /^ghcr\.io\/([^/]+)\/([^:]+)(?::(.+))?$/.exec(imageName.trim());
  if (!match) return true;
  const [, owner, repo, tag = "latest"] = match;
  const scope = `repository:${owner}/${repo}:pull`;
  try {
    const tokenRes = await fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!tokenRes.ok) return false;
    const tokenBody = (await tokenRes.json()) as { token?: string; errors?: unknown[] };
    if (!tokenBody.token) return false;
    const manifestRes = await fetch(
      `https://ghcr.io/v2/${owner}/${repo}/manifests/${tag}`,
      {
        headers: {
          Authorization: `Bearer ${tokenBody.token}`,
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    return manifestRes.ok;
  } catch {
    return false;
  }
}

async function resolveDeployPlan(registryAuthId?: string): Promise<DeployPlan> {
  const forcedBootstrap = process.env.RUNPOD_BOOTSTRAP?.trim().toLowerCase();
  if (forcedBootstrap === "1" || forcedBootstrap === "true" || forcedBootstrap === "yes") {
    return {
      imageName: BOOTSTRAP_IMAGE,
      dockerArgs: bootstrapDockerArgs(),
      bootstrap: true,
    };
  }
  if (forcedBootstrap === "0" || forcedBootstrap === "false" || forcedBootstrap === "no") {
    return {
      imageName: DEFAULT_IMAGE,
      registryAuthId,
      bootstrap: false,
    };
  }

  const explicitImage = process.env.MURMUR_MUSIC_IMAGE?.trim();
  if (explicitImage && !explicitImage.includes("ghcr.io/")) {
    return { imageName: explicitImage, bootstrap: false };
  }

  if (registryAuthId) {
    return { imageName: DEFAULT_IMAGE, registryAuthId, bootstrap: false };
  }

  if (needsRegistryAuth(DEFAULT_IMAGE)) {
    const pullable = await ghcrImagePullableAnonymously(DEFAULT_IMAGE);
    if (!pullable) {
      return {
        imageName: BOOTSTRAP_IMAGE,
        dockerArgs: bootstrapDockerArgs(),
        bootstrap: true,
      };
    }
  }

  return { imageName: DEFAULT_IMAGE, bootstrap: false };
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

async function terminatePod(apiKey: string, podId: string) {
  try {
    await runpodMutation(apiKey, `mutation($id: String!) { podTerminate(input: { podId: $id }) }`, {
      id: podId,
    });
  } catch {
    // already gone
  }
}

async function listGpuCandidates(apiKey: string): Promise<string[]> {
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

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const candidate of GPU_CANDIDATES) {
    const hit = data.gpuTypes.find(
      (g) => g.id === candidate || g.displayName === candidate,
    );
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      picked.push(hit.id);
    }
  }
  for (const g of data.gpuTypes.filter((x) => x.memoryInGb >= 16)) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      picked.push(g.id);
    }
  }
  return picked;
}

async function deployWithGpuFallback(
  apiKey: string,
  token: string,
  plan: DeployPlan,
): Promise<PodSummary> {
  const candidates = await listGpuCandidates(apiKey);
  if (!candidates.length) {
    throw new Error("No suitable RunPod GPU type found. Set RUNPOD_GPU_TYPE_ID explicitly.");
  }

  let lastError = "unknown";
  for (const gpuTypeId of candidates.slice(0, 8)) {
    console.log(`Trying GPU type: ${gpuTypeId}`);
    try {
      const created = await deployPod(apiKey, gpuTypeId, token, plan);
      return await waitForPod(apiKey, created.id);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`  unavailable: ${lastError}`);
      if (!/not enough free gpus|no instances|capacity|available/i.test(lastError)) {
        throw err;
      }
    }
  }
  throw new Error(`All GPU types unavailable. Last error: ${lastError}`);
}

async function pickGpuType(apiKey: string): Promise<string> {
  const candidates = await listGpuCandidates(apiKey);
  if (!candidates[0]) {
    throw new Error("No suitable RunPod GPU type found. Set RUNPOD_GPU_TYPE_ID explicitly.");
  }
  return candidates[0];
}

async function deployPod(
  apiKey: string,
  gpuTypeId: string,
  token: string,
  plan: DeployPlan,
): Promise<{ id: string }> {
  const input: Record<string, unknown> = {
    cloudType: "SECURE",
    gpuCount: 1,
    gpuTypeId,
    name: POD_NAME,
    imageName: plan.imageName,
    containerDiskInGb: plan.bootstrap ? 40 : 30,
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
      { key: "MURMUR_GIT_REF", value: process.env.MURMUR_GIT_REF?.trim() || "main" },
    ],
  };
  if (plan.dockerArgs) {
    input.dockerArgs = plan.dockerArgs;
  }
  if (plan.registryAuthId) {
    input.containerRegistryAuthId = plan.registryAuthId;
  }

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
    { input },
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
        if (body.status === "ok" || body.loaded === true) return true;
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
