import { ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV } from "@/lib/billing/zpay";
import { collectDatabaseEnvAuditIssues } from "@/lib/db/config";
import { privateSongAudioDeliveryEnabled } from "@/lib/storage/song-audio";

const REQUIRED_IN_PRODUCTION = [
  // The database DSN contract (DATABASE_URL / POSTGRES_URL precedence, pooler
  // hostname) lives in one place: collectDatabaseEnvAuditIssues() in
  // src/lib/db/config.ts, which this script folds into `missing` below. Keeping
  // it out of this table avoids two competing definitions of the DB contract.
  {
    keys: ["AUTH_URL", "NEXTAUTH_URL", "MURMUR_APP_URL", "VERCEL_URL"],
    label: "AUTH_URL, NEXTAUTH_URL, MURMUR_APP_URL, or VERCEL_URL",
    anyOf: true,
  },
  {
    keys: ["MURMUR_STORAGE_DRIVER"],
    label: "MURMUR_STORAGE_DRIVER",
  },
  {
    keys: ["WAFFO_MERCHANT_ID"],
    label: "WAFFO_MERCHANT_ID",
  },
  {
    keys: ["WAFFO_PRIVATE_KEY", "WAFFO_PRIVATE_KEY_BASE64"],
    label: "WAFFO_PRIVATE_KEY or WAFFO_PRIVATE_KEY_BASE64",
    anyOf: true,
  },
  {
    keys: ["WAFFO_TOPUP_PRODUCT_ID"],
    label: "WAFFO_TOPUP_PRODUCT_ID",
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

function isTruthyValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function collectProductionFallbackEnvAuditIssues(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const issues: string[] = [];
  if (isTruthyValue(env.MURMUR_ALLOW_DEV_BILLING_FALLBACK)) {
    issues.push("MURMUR_ALLOW_DEV_BILLING_FALLBACK must be unset/false in production");
  }
  if (isTruthyValue(env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW)) {
    issues.push("MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW must be unset/false in production");
  }

  const authMode = env.MURMUR_AUTH_MODE?.trim().toLowerCase();
  if (authMode && authMode !== "production" && authMode !== "prod") {
    issues.push("MURMUR_AUTH_MODE must be production/prod in production");
  }
  const publicAuthMode = env.NEXT_PUBLIC_MURMUR_AUTH_MODE?.trim().toLowerCase();
  if (publicAuthMode && publicAuthMode !== "production" && publicAuthMode !== "prod") {
    issues.push("NEXT_PUBLIC_MURMUR_AUTH_MODE must be unset or production/prod in production");
  }
  return issues;
}

function isPlaceholderSecret(key: string): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  return !value || value === "replace_with_a_long_random_string";
}

type UrlRule = {
  keys: readonly string[];
  protocols: readonly string[];
};

const URL_RULES: readonly UrlRule[] = [
  { keys: ["DATABASE_URL", "POSTGRES_URL"], protocols: ["postgres:", "postgresql:"] },
  { keys: ["AUTH_URL", "NEXTAUTH_URL", "MURMUR_APP_URL"], protocols: ["http:", "https:"] },
  { keys: ["AUDIO_WORKER_URL", "MUSIC_WORKER_URL"], protocols: ["http:", "https:"] },
  { keys: ["MURMUR_STORAGE_S3_PUBLIC_URL_BASE"], protocols: ["http:", "https:"] },
];

export function collectUrlEnvAuditIssues(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const issues: string[] = [];
  for (const rule of URL_RULES) {
    for (const key of rule.keys) {
      const value = env[key]?.trim();
      if (!value) continue;
      try {
        const url = new URL(value);
        if (!rule.protocols.includes(url.protocol)) {
          issues.push(`${key} must use ${rule.protocols.join(" or ")}`);
        }
      } catch {
        issues.push(`${key} must be a valid absolute URL`);
      }
    }
  }
  return issues;
}

export function collectDurableRuntimeEnvAuditIssues(
  env: Readonly<Record<string, string | undefined>>,
  environment: "preview" | "production",
): string[] {
  const issues: string[] = [];
  const declaredEnvironment = env.MURMUR_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (declaredEnvironment !== environment) {
    issues.push(`MURMUR_DEPLOYMENT_ENV must be ${environment} on Vercel ${environment}`);
  }

  const rateLimitDriver = env.MURMUR_RATE_LIMIT_DRIVER?.trim().toLowerCase();
  if (rateLimitDriver && rateLimitDriver !== "postgres") {
    issues.push(`MURMUR_RATE_LIMIT_DRIVER must be unset or postgres on Vercel ${environment}`);
  }

  if (environment === "production" && !isTruthyValue(env.MURMUR_STORAGE_TMP_LIFECYCLE_CONFIRMED)) {
    issues.push(
      "MURMUR_STORAGE_TMP_LIFECYCLE_CONFIRMED must be true after verifying a 24-hour tmp/ bucket lifecycle",
    );
  }
  return issues;
}

/**
 * Misconfiguration that makes a Preview deployment unsafe: a mislabelled
 * environment, a database DSN that would exhaust connections, a malformed URL,
 * or a production fallback switch left on. These always fail the build,
 * because shipping them is worse than not shipping at all.
 */
export function collectPreviewIsolationEnvAuditIssues(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return [
    ...collectDurableRuntimeEnvAuditIssues(env, "preview"),
    ...collectDatabaseEnvAuditIssues(env),
    ...collectUrlEnvAuditIssues(env),
    ...collectProductionFallbackEnvAuditIssues(env),
  ];
}

/**
 * Provisioning that a Preview deployment needs to be *functionally* equal to
 * production: its own bucket and its own worker credentials.
 *
 * Absence is reported separately from misconfiguration because it is not a
 * safety problem — `getObjectStore()` already refuses to run with an
 * unconfigured driver, so an unprovisioned Preview fails closed at the first
 * storage call instead of writing somewhere it should not. Blocking the build
 * on it instead makes the required `Vercel` status check unsatisfiable, which
 * blocks *every* pull request in the repository, including the one that would
 * provision the environment.
 *
 * Set MURMUR_PREVIEW_REQUIRE_FULL_STACK=1 in the Vercel Preview environment
 * once the preview bucket and worker credentials exist; from then on these are
 * blocking again and Preview deployments are held to the production contract.
 */
export function collectPreviewProvisioningEnvAuditIssues(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const issues: string[] = [];
  if (env.MURMUR_STORAGE_DRIVER?.trim() !== "s3-compatible") {
    issues.push("MURMUR_STORAGE_DRIVER must be s3-compatible on Vercel preview");
  }
  for (const key of REQUIRED_S3_ENV) {
    if (!env[key]?.trim()) issues.push(`${key} is required on Vercel preview`);
  }
  for (const key of ["AUDIO_WORKER_TOKEN", "RUNPOD_API_KEY"] as const) {
    if (!env[key]?.trim()) issues.push(`${key} is required on Vercel preview`);
  }
  if (
    !privateSongAudioDeliveryEnabled(env)
    && !env.MURMUR_STORAGE_S3_PUBLIC_URL_BASE?.trim()
  ) {
    issues.push(
      "MURMUR_STORAGE_S3_PUBLIC_URL_BASE is required on Vercel preview until private song audio delivery is enabled",
    );
  }
  return issues;
}

export function previewRequiresFullStack(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return isTruthyValue(env.MURMUR_PREVIEW_REQUIRE_FULL_STACK);
}

function main() {
  const onVercel = process.env.VERCEL === "1";
  const inCi = process.env.CI === "true";
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  const productionDeployment =
    vercelEnv === "production" ||
    (!onVercel && process.env.NODE_ENV === "production");

  const previewDeployment = onVercel && vercelEnv === "preview";
  if (previewDeployment) {
    const blocking = collectPreviewIsolationEnvAuditIssues(process.env);
    const provisioning = collectPreviewProvisioningEnvAuditIssues(process.env);
    const strict = previewRequiresFullStack(process.env);
    if (strict) blocking.push(...provisioning);

    if (blocking.length > 0) {
      console.error("Preview env audit failed:");
      for (const item of blocking) console.error(`  - ${item}`);
      process.exitCode = 1;
      return;
    }
    if (provisioning.length > 0) {
      console.warn("Preview env audit passed with an unprovisioned stack:");
      for (const item of provisioning) console.warn(`  - ${item}`);
      console.warn(
        "  Storage-backed routes fail closed at runtime until these are set."
        + " Set MURMUR_PREVIEW_REQUIRE_FULL_STACK=1 to make them blocking again.",
      );
      return;
    }
    console.log("Preview env audit passed.");
    return;
  }

  if (!productionDeployment || (!onVercel && !inCi)) {
    console.log("env audit skipped (not production deployment CI/Vercel).");
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

  missing.push(...collectDatabaseEnvAuditIssues(process.env));
  missing.push(...collectUrlEnvAuditIssues(process.env));
  if (onVercel) {
    missing.push(...collectDurableRuntimeEnvAuditIssues(process.env, "production"));
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

  missing.push(...collectProductionFallbackEnvAuditIssues(process.env));

  const zpayHasPid = Boolean(process.env.ZPAY_PID?.trim());
  const zpayHasKey = Boolean(process.env.ZPAY_KEY?.trim());
  if (zpayHasPid !== zpayHasKey) {
    missing.push("ZPAY_PID and ZPAY_KEY must both be set for ZPay, or both unset");
  }

  if (zpayHasPid && zpayHasKey && !isTruthyEnv(ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV)) {
    missing.push(
      `${ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV}=1 is required to enable production ZPay checkout until refund/reversal webhooks are implemented`,
    );
  }

  if (isTruthyEnv("MURMUR_CAPTURE_HUMS")) {
    missing.push("MURMUR_CAPTURE_HUMS must be unset/false in production");
  }

  if (isPlaceholderSecret("CRON_SECRET")) {
    missing.push("CRON_SECRET must be a non-placeholder secret");
  }

  const storageDriver = process.env.MURMUR_STORAGE_DRIVER?.trim();
  if (onVercel && storageDriver !== "s3-compatible") {
    missing.push("MURMUR_STORAGE_DRIVER must be s3-compatible on Vercel production");
  }

  if (storageDriver === "s3-compatible") {
    for (const key of REQUIRED_S3_ENV) {
      if (!process.env[key]?.trim()) missing.push(key);
    }
    if (
      !privateSongAudioDeliveryEnabled(process.env)
      && !process.env.MURMUR_STORAGE_S3_PUBLIC_URL_BASE?.trim()
    ) {
      missing.push(
        "MURMUR_STORAGE_S3_PUBLIC_URL_BASE (required until private song audio delivery is enabled)",
      );
    }
  }

  if (process.env.MUSIC_WORKER_URL?.trim() && !process.env.MUSIC_WORKER_TOKEN?.trim()) {
    missing.push("MUSIC_WORKER_TOKEN (required when MUSIC_WORKER_URL is configured)");
  }

  if (missing.length > 0) {
    console.error("Production env audit failed:");
    for (const item of missing) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log("Production env audit passed.");
}

if (import.meta.main) {
  main();
}
