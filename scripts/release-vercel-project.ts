type VercelTarget = "preview" | "production" | "development";

export interface VercelEnvRecord {
  id?: string;
  key?: string;
  value?: string;
  type?: string;
  target?: VercelTarget | VercelTarget[];
  gitBranch?: string;
  configurationId?: string | null;
}

interface VercelProjectSnapshot {
  name?: string;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null;
}

interface RollingConfigSnapshot {
  rollingRelease?: unknown;
}

interface RollingReleaseSnapshot {
  rollingRelease?: { state?: string } | null;
}

export const RELEASE_RESOURCE_IDENTITIES = [
  "MURMUR_DATABASE_RESOURCE_ID",
  "MURMUR_STORAGE_RESOURCE_ID",
  "MURMUR_AUDIO_WORKER_RESOURCE_ID",
  "MURMUR_MUSIC_WORKER_RESOURCE_ID",
] as const;

const RELEASE_CREDENTIALS = [
  "MURMUR_STORAGE_S3_ACCESS_KEY_ID",
  "MURMUR_STORAGE_S3_SECRET_ACCESS_KEY",
  "AUDIO_WORKER_TOKEN",
  "RUNPOD_API_KEY",
] as const;

function targets(record: VercelEnvRecord): VercelTarget[] {
  if (!record.target) return [];
  return Array.isArray(record.target) ? record.target : [record.target];
}

function effectiveRecord(
  records: VercelEnvRecord[],
  key: string,
  target: "preview" | "production",
  previewBranch?: string,
): VercelEnvRecord | null {
  const matching = records.filter((record) => record.key === key && targets(record).includes(target));
  if (target === "preview" && previewBranch) {
    const branch = matching.filter((record) => record.gitBranch === previewBranch);
    if (branch.length === 1) return branch[0];
    if (branch.length > 1) return null;
  }
  const global = matching.filter((record) => !record.gitBranch);
  return global.length === 1 ? global[0] : null;
}

function plainIdentity(record: VercelEnvRecord | null): string | null {
  if (!record || record.type !== "plain") return null;
  return record.value?.trim().toLowerCase() || null;
}

export function collectVercelProjectIssues(input: {
  project: VercelProjectSnapshot;
  rollingConfig: RollingConfigSnapshot;
  rollingRelease: RollingReleaseSnapshot;
  envs: VercelEnvRecord[];
  expectedProject: string;
  expectedOrg: string;
  expectedRepo: string;
  previewBranch?: string;
  expectedMusicWorkerResourceId?: string;
  expectedMusicWorkerSha?: string;
  expectedDatabaseResourceId?: string;
  expectedAudioWorkerResourceId?: string;
}): string[] {
  const issues: string[] = [];
  if (input.project.name !== input.expectedProject) issues.push("Vercel project identity mismatch");
  const link = input.project.link;
  if (
    !link
    || !String(link.type ?? "").startsWith("github")
    || link.org !== input.expectedOrg
    || link.repo !== input.expectedRepo
    || link.productionBranch !== "main"
  ) {
    issues.push("Vercel Git link must target the expected GitHub repository with main as production branch");
  }
  if (input.rollingConfig.rollingRelease != null) {
    issues.push("Vercel Rolling Releases must be disabled for future deployments");
  }
  if (input.rollingRelease.rollingRelease?.state === "ACTIVE") {
    issues.push("An active Vercel Rolling Release must be resolved before release");
  }

  for (const key of RELEASE_RESOURCE_IDENTITIES) {
    const preview = effectiveRecord(input.envs, key, "preview", input.previewBranch);
    const production = effectiveRecord(input.envs, key, "production");
    const previewIdentity = plainIdentity(preview);
    const productionIdentity = plainIdentity(production);
    if (!previewIdentity) issues.push(`Preview ${key} must be a single plain non-secret value`);
    if (!productionIdentity) issues.push(`Production ${key} must be a single plain non-secret value`);
    if (previewIdentity && productionIdentity && previewIdentity === productionIdentity) {
      issues.push(`Preview ${key} must differ from Production`);
    }
    if (
      key === "MURMUR_DATABASE_RESOURCE_ID"
      && input.expectedDatabaseResourceId
      && productionIdentity !== input.expectedDatabaseResourceId.toLowerCase()
    ) {
      issues.push("Production database resource marker must equal the verified database identity");
    }
    if (
      key === "MURMUR_AUDIO_WORKER_RESOURCE_ID"
      && input.expectedAudioWorkerResourceId
      && productionIdentity?.replace(/\/+$/, "")
        !== input.expectedAudioWorkerResourceId.toLowerCase().replace(/\/+$/, "")
    ) {
      issues.push("Production Audio Worker resource marker must equal the health-checked origin");
    }
    if (
      key === "MURMUR_MUSIC_WORKER_RESOURCE_ID"
      && input.expectedMusicWorkerResourceId
      && productionIdentity !== input.expectedMusicWorkerResourceId.toLowerCase()
    ) {
      issues.push("Production music resource marker must equal the canary endpoint id");
    }
  }

  const productionMusicRevision = effectiveRecord(
    input.envs,
    "MURMUR_MUSIC_RELEASE_SHA",
    "production",
  );
  if (
    productionMusicRevision?.type !== "plain"
    || !/^[0-9a-f]{40}$/i.test(productionMusicRevision.value?.trim() ?? "")
  ) {
    issues.push("Production MURMUR_MUSIC_RELEASE_SHA must be one plain immutable Worker SHA");
  } else if (
    input.expectedMusicWorkerSha
    && productionMusicRevision.value?.trim().toLowerCase()
      !== input.expectedMusicWorkerSha.toLowerCase()
  ) {
    issues.push("Production Worker revision marker must equal the canary Worker SHA");
  }

  for (const key of RELEASE_CREDENTIALS) {
    const preview = effectiveRecord(input.envs, key, "preview", input.previewBranch);
    const production = effectiveRecord(input.envs, key, "production");
    if (!preview?.id || preview.type !== "sensitive") {
      issues.push(`Preview ${key} must have one sensitive environment-scoped Vercel record`);
    }
    if (!production?.id || production.type !== "sensitive") {
      issues.push(`Production ${key} must have one sensitive environment-scoped Vercel record`);
    }
    if (preview?.id && preview.id === production?.id) {
      issues.push(`${key} must not use one Vercel record for Preview and Production`);
    }
  }
  return issues;
}

async function vercelApi(path: string, token: string, scope: string): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("slug", scope);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Vercel ${path} returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

if (import.meta.main) {
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectName = process.env.VERCEL_PROJECT_NAME?.trim();
  const scope = process.env.VERCEL_SCOPE?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const previewBranch = process.env.VERCEL_PREVIEW_BRANCH?.trim() || undefined;
  const expectedMusicWorkerResourceId = process.env.EXPECTED_MUSIC_WORKER_RESOURCE_ID?.trim();
  const expectedMusicWorkerSha = process.env.EXPECTED_MUSIC_WORKER_SHA?.trim();
  const expectedDatabaseResourceId = process.env.EXPECTED_DATABASE_RESOURCE_ID?.trim();
  const expectedAudioWorkerResourceId = process.env.EXPECTED_AUDIO_WORKER_RESOURCE_ID?.trim();
  if (!token || !projectName || !scope || !repository?.includes("/")) {
    throw new Error("VERCEL_TOKEN, VERCEL_PROJECT_NAME, VERCEL_SCOPE, and GITHUB_REPOSITORY are required");
  }
  const [expectedOrg, expectedRepo] = repository.split("/", 2);
  const encoded = encodeURIComponent(projectName);
  const [project, rollingConfig, rollingRelease, envResponse] = await Promise.all([
    vercelApi(`/v9/projects/${encoded}`, token, scope),
    vercelApi(`/v1/projects/${encoded}/rolling-release/config`, token, scope),
    vercelApi(`/v1/projects/${encoded}/rolling-release`, token, scope),
    vercelApi(`/v10/projects/${encoded}/env`, token, scope),
  ]);
  const issues = collectVercelProjectIssues({
    project,
    rollingConfig,
    rollingRelease,
    envs: Array.isArray(envResponse.envs) ? envResponse.envs as VercelEnvRecord[] : [],
    expectedProject: projectName,
    expectedOrg,
    expectedRepo,
    previewBranch,
    expectedMusicWorkerResourceId,
    expectedMusicWorkerSha,
    expectedDatabaseResourceId,
    expectedAudioWorkerResourceId,
  });
  if (issues.length > 0) {
    console.error("Vercel project preflight failed:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log("Vercel project preflight passed without reading secret values.");
}
