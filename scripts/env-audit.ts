const REQUIRED_IN_PRODUCTION = [
  {
    keys: ["DATABASE_URL", "POSTGRES_URL"],
    label: "DATABASE_URL or POSTGRES_URL",
    anyOf: true,
  },
  {
    keys: ["MURMUR_STORAGE_DRIVER"],
    label: "MURMUR_STORAGE_DRIVER",
  },
  {
    keys: ["MURMUR_APP_URL"],
    label: "MURMUR_APP_URL",
  },
  {
    keys: ["AUTH_URL"],
    label: "AUTH_URL",
  },
  {
    keys: ["AUDIO_WORKER_URL"],
    label: "AUDIO_WORKER_URL",
  },
  {
    keys: ["AUDIO_WORKER_TOKEN"],
    label: "AUDIO_WORKER_TOKEN",
  },
  {
    keys: ["RUNPOD_SERVERLESS_ENDPOINT_ID"],
    label: "RUNPOD_SERVERLESS_ENDPOINT_ID",
  },
  {
    keys: ["RUNPOD_API_KEY"],
    label: "RUNPOD_API_KEY",
  },
  {
    keys: ["CRON_SECRET"],
    label: "CRON_SECRET",
  },
] as const;

const REQUIRED_S3_ENV = [
  "MURMUR_STORAGE_S3_BUCKET",
  "MURMUR_STORAGE_S3_REGION",
  "MURMUR_STORAGE_S3_ACCESS_KEY_ID",
  "MURMUR_STORAGE_S3_SECRET_ACCESS_KEY",
] as const;

function hasAny(keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function isTruthyEnv(key: string): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isPlaceholderSecret(key: string): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  return !value || value === "replace_with_a_long_random_string";
}

function main() {
  const onVercel = process.env.VERCEL === "1";
  const inCi = process.env.CI === "true";
  const production =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (!production || (!onVercel && !inCi)) {
    console.log("env audit skipped (not production CI/Vercel).");
    return;
  }

  const missing: string[] = [];

  for (const rule of REQUIRED_IN_PRODUCTION) {
    if ("anyOf" in rule && rule.anyOf) {
      if (!hasAny(rule.keys)) missing.push(rule.label);
    } else if (!hasAny(rule.keys)) {
      missing.push(rule.label);
    }
  }

  const googleConfigured =
    Boolean(process.env.GOOGLE_CLIENT_ID?.trim()) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());

  if (
    googleConfigured &&
    !process.env.AUTH_SECRET?.trim() &&
    !process.env.NEXTAUTH_SECRET?.trim()
  ) {
    missing.push("AUTH_SECRET (required when Google OAuth is configured)");
  }

  const githubConfigured =
    Boolean(process.env.GITHUB_CLIENT_ID?.trim()) &&
    Boolean(process.env.GITHUB_CLIENT_SECRET?.trim());

  if (
    githubConfigured &&
    !process.env.AUTH_SECRET?.trim() &&
    !process.env.NEXTAUTH_SECRET?.trim()
  ) {
    missing.push("AUTH_SECRET (required when GitHub OAuth is configured)");
  }

  if (isTruthyEnv("MURMUR_ALLOW_DEV_BILLING_FALLBACK")) {
    missing.push("MURMUR_ALLOW_DEV_BILLING_FALLBACK must be unset/false in production");
  }

  if (isTruthyEnv("MURMUR_CAPTURE_HUMS")) {
    missing.push("MURMUR_CAPTURE_HUMS must be unset/false in production");
  }

  if (isPlaceholderSecret("CRON_SECRET")) {
    missing.push("CRON_SECRET must be a non-placeholder secret");
  }

  if (process.env.MURMUR_STORAGE_DRIVER?.trim() === "s3-compatible") {
    for (const key of REQUIRED_S3_ENV) {
      if (!process.env[key]?.trim()) missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error("Production env audit failed. Missing:");
    for (const item of missing) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log("Production env audit passed.");
}

main();
