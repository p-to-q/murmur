import { parse } from "dotenv";

type Environment = Readonly<Record<string, string | undefined>>;

type ResourceRule = {
  label: string;
  keys: readonly string[];
  normalize?: (value: string) => string | null;
};

const RESOURCE_RULES: readonly ResourceRule[] = [
  {
    label: "database",
    keys: ["DATABASE_URL", "POSTGRES_URL"],
    normalize: databaseIdentity,
  },
  { label: "storage bucket", keys: ["MURMUR_STORAGE_S3_BUCKET"] },
  {
    label: "audio Worker endpoint",
    keys: ["AUDIO_WORKER_URL"],
    normalize: endpointIdentity,
  },
  {
    label: "music Worker endpoint",
    keys: ["RUNPOD_SERVERLESS_ENDPOINT_ID"],
  },
];

const CREDENTIAL_RULES: readonly ResourceRule[] = [
  { label: "storage access key", keys: ["MURMUR_STORAGE_S3_ACCESS_KEY_ID"] },
  { label: "storage secret", keys: ["MURMUR_STORAGE_S3_SECRET_ACCESS_KEY"] },
  { label: "audio Worker token", keys: ["AUDIO_WORKER_TOKEN"] },
  { label: "music Worker API key", keys: ["RUNPOD_API_KEY"] },
];

function firstValue(env: Environment, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function databaseIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const database = url.pathname.replace(/^\/+/, "").toLowerCase();
    if (!url.hostname || !database) return null;
    return `${url.hostname.toLowerCase()}/${database}`;
  } catch {
    return null;
  }
}

function endpointIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function normalizedValue(env: Environment, rule: ResourceRule): string | null {
  const value = firstValue(env, rule.keys);
  if (!value) return null;
  return rule.normalize ? rule.normalize(value) : value.toLowerCase();
}

export function collectReleaseEnvironmentIsolationIssues(
  preview: Environment,
  production: Environment,
): string[] {
  const issues: string[] = [];
  if (preview.MURMUR_DEPLOYMENT_ENV?.trim().toLowerCase() !== "preview") {
    issues.push("Preview MURMUR_DEPLOYMENT_ENV must be preview");
  }
  if (production.MURMUR_DEPLOYMENT_ENV?.trim().toLowerCase() !== "production") {
    issues.push("Production MURMUR_DEPLOYMENT_ENV must be production");
  }

  for (const rule of RESOURCE_RULES) {
    const previewValue = normalizedValue(preview, rule);
    const productionValue = normalizedValue(production, rule);
    if (!previewValue) issues.push(`Preview ${rule.label} identity is missing or invalid`);
    if (!productionValue) issues.push(`Production ${rule.label} identity is missing or invalid`);
    if (previewValue && productionValue && previewValue === productionValue) {
      issues.push(`Preview ${rule.label} must differ from Production`);
    }
  }

  for (const rule of CREDENTIAL_RULES) {
    const previewValue = firstValue(preview, rule.keys);
    const productionValue = firstValue(production, rule.keys);
    if (!previewValue) issues.push(`Preview ${rule.label} is missing`);
    if (!productionValue) issues.push(`Production ${rule.label} is missing`);
  }
  return issues;
}

export function parseDotenv(text: string): Record<string, string> {
  return parse(text);
}

if (import.meta.main) {
  const previewPath = process.argv[2]?.trim();
  const productionPath = process.argv[3]?.trim();
  if (!previewPath || !productionPath) {
    throw new Error(
      "Usage: bun scripts/release-env-isolation.ts <preview-env-file> <production-env-file>",
    );
  }
  const preview = parseDotenv(await Bun.file(previewPath).text());
  const production = parseDotenv(await Bun.file(productionPath).text());
  const issues = collectReleaseEnvironmentIsolationIssues(preview, production);
  if (issues.length > 0) {
    console.error("Release environment isolation audit failed:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log("Release environment isolation audit passed.");
}
