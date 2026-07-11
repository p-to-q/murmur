export const DEFAULT_DB_POOL_MAX = 5;
export const MIN_DB_POOL_MAX = 1;
export const MAX_DB_POOL_MAX = 10;

type DatabaseEnv = Readonly<Record<string, string | undefined>>;

export type DatabaseHostnameKind = "neon-direct" | "neon-pooler" | "other";

export function resolveDatabaseUrl(env: DatabaseEnv = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || undefined;
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

  if (
    connectionString &&
    classifyDatabaseHostname(connectionString) === "neon-direct"
  ) {
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
