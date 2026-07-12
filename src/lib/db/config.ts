export const DEFAULT_DB_POOL_MAX = 5;
export const MIN_DB_POOL_MAX = 1;
export const MAX_DB_POOL_MAX = 10;

type DatabaseEnv = Readonly<Record<string, string | undefined>>;

export type DatabaseHostnameKind = "neon-direct" | "neon-pooler" | "other";

/**
 * The connection string every local operator gets from `.env.example` and the
 * `compose.yaml` Postgres. Used ONLY when a caller explicitly signals local
 * development — never as a silent production default.
 */
export const LOCAL_DEV_FALLBACK_DSN =
  "postgresql://postgres:password@localhost:5432/myapp";

/**
 * Runtime precedence. Vercel's Postgres integration injects `POSTGRES_URL`;
 * self-hosted / Neon-direct deployments use `DATABASE_URL`. This is the pooled
 * connection the serverless app opens per warm instance.
 */
export const RUNTIME_DSN_KEYS = ["DATABASE_URL", "POSTGRES_URL"] as const;

/**
 * Migration precedence. DDL should run against the DIRECT (unpooled) endpoint so
 * it does not go through PgBouncer, which does not support every statement a
 * migration issues. Neon / Vercel expose the unpooled endpoint as
 * `DATABASE_URL_UNPOOLED` (documented Murmur contract) or
 * `POSTGRES_URL_NON_POOLING` (Vercel's Neon integration). When neither unpooled
 * var is present we fall back to the same runtime precedence so a single-URL
 * local setup still works.
 */
export const MIGRATION_DSN_KEYS = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

function firstNonEmpty(
  env: DatabaseEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Peek at the configured RUNTIME connection string without failing when it is
 * absent. Used by the env audit to classify the pooled hostname; the runtime
 * client and the migration script go through {@link resolveServerDsn}, which
 * fails closed instead of returning `undefined`.
 */
export function resolveDatabaseUrl(env: DatabaseEnv = process.env): string | undefined {
  return firstNonEmpty(env, RUNTIME_DSN_KEYS);
}

/**
 * Whether an absent DSN may fall back to {@link LOCAL_DEV_FALLBACK_DSN} instead
 * of throwing. This is the single "explicit local-dev signal" the DSN resolver
 * requires so an operator who means to target production but sets nothing gets a
 * loud failure rather than a silent localhost connection.
 *
 * - `development` / `test` runtimes fall back (this is real local work).
 * - `production` never falls back.
 * - An unset / unknown `NODE_ENV` falls back ONLY with an explicit opt-in
 *   (`MURMUR_DB_ALLOW_LOCAL_FALLBACK=1|true|yes`).
 *
 * The Next.js build phase is handled separately by the runtime client, which
 * must not throw while Vercel evaluates modules before injecting runtime env.
 */
export function isExplicitLocalDev(env: DatabaseEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "development" || nodeEnv === "test") return true;
  if (nodeEnv === "production") return false;

  const optIn = env.MURMUR_DB_ALLOW_LOCAL_FALLBACK?.trim().toLowerCase();
  return optIn === "1" || optIn === "true" || optIn === "yes";
}

export interface ResolveServerDsnOptions {
  /**
   * Use the migration precedence (prefer the explicit unpooled endpoint). When
   * false, the runtime pooled precedence is used.
   */
  isMigration?: boolean;
  /**
   * When true, an absent DSN falls back to {@link LOCAL_DEV_FALLBACK_DSN}
   * instead of throwing. Callers MUST derive this from an explicit local-dev
   * signal (see {@link isExplicitLocalDev}) — never hard-code it to `true`.
   */
  isExplicitLocalDev?: boolean;
}

/**
 * The one server-side DSN resolver, shared by the runtime client, the migration
 * script, and Drizzle Kit. Enforces a single fail-closed precedence contract:
 *
 * - migration context: DATABASE_URL_UNPOOLED → POSTGRES_URL_NON_POOLING →
 *   DATABASE_URL → POSTGRES_URL
 * - runtime context:   DATABASE_URL → POSTGRES_URL
 *
 * When no DSN is configured it throws a clear error UNLESS the caller opted into
 * the local-dev fallback, in which case it returns {@link LOCAL_DEV_FALLBACK_DSN}.
 * It never silently defaults to localhost.
 */
export function resolveServerDsn(
  env: DatabaseEnv = process.env,
  { isMigration = false, isExplicitLocalDev = false }: ResolveServerDsnOptions = {},
): string {
  const keys = isMigration ? MIGRATION_DSN_KEYS : RUNTIME_DSN_KEYS;
  const configured = firstNonEmpty(env, keys);
  if (configured) return configured;

  if (isExplicitLocalDev) return LOCAL_DEV_FALLBACK_DSN;

  throw new Error(
    `No database connection string is set. Provide one of: ${keys.join(", ")}. ` +
      "Refusing to silently connect to a localhost database outside explicit " +
      "local development. Set the connection string, or — for local work only — " +
      "opt in with MURMUR_DB_ALLOW_LOCAL_FALLBACK=1 (or NODE_ENV=development).",
  );
}

export function classifyDatabaseHostname(connectionString: string): DatabaseHostnameKind {
  let hostname: string;

  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    return "other";
  }

  if (hostname !== "neon.tech" && !hostname.endsWith(".neon.tech")) {
    return "other";
  }

  const endpointLabel = hostname.split(".")[0];
  return endpointLabel.endsWith("-pooler") ? "neon-pooler" : "neon-direct";
}

export function resolveDbPoolMax(raw = process.env.MURMUR_DB_POOL_MAX): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_DB_POOL_MAX;

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `MURMUR_DB_POOL_MAX must be an integer from ${MIN_DB_POOL_MAX} to ${MAX_DB_POOL_MAX}`,
    );
  }

  const parsed = Number(value);
  if (parsed < MIN_DB_POOL_MAX || parsed > MAX_DB_POOL_MAX) {
    throw new Error(
      `MURMUR_DB_POOL_MAX must be an integer from ${MIN_DB_POOL_MAX} to ${MAX_DB_POOL_MAX}`,
    );
  }

  return parsed;
}

export function collectDatabaseEnvAuditIssues(env: DatabaseEnv): string[] {
  const issues: string[] = [];
  const connectionString = resolveDatabaseUrl(env);

  if (!connectionString) {
    issues.push(
      "DATABASE_URL or POSTGRES_URL must be set (the runtime pooled connection string)",
    );
  } else if (classifyDatabaseHostname(connectionString) === "neon-direct") {
    issues.push(
      "DATABASE_URL / POSTGRES_URL must use a Neon pooler hostname (*-pooler.<region>.neon.tech) in production; direct Neon endpoints can exhaust connection limits",
    );
  }

  try {
    resolveDbPoolMax(env.MURMUR_DB_POOL_MAX);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return issues;
}
