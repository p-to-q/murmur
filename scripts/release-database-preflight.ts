import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

import { config } from "dotenv";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

import { isExplicitLocalDev, resolveDatabaseUrl, resolveServerDsn } from "../src/lib/db/config";
import { databaseIdentity } from "./release-env-isolation";

export interface RepositoryMigration {
  createdAt: number;
  hash: string;
}

export interface MigrationLedgerRow {
  id: string;
  createdAt: number | null;
  hash: string | null;
}

export function collectMigrationLedgerIssues(input: {
  tableExists: boolean;
  ledgerRows: MigrationLedgerRow[];
  repositoryMigrations: RepositoryMigration[];
  requireComplete?: boolean;
  migrationDatabaseIdentity?: string | null;
  runtimeDatabaseIdentity?: string | null;
}): string[] {
  const issues: string[] = [];
  const repository = input.repositoryMigrations;

  if (repository.length === 0) {
    issues.push("Repository migration journal is empty");
  }
  for (let index = 0; index < repository.length; index += 1) {
    const migration = repository[index];
    if (!Number.isSafeInteger(migration.createdAt) || migration.createdAt <= 0) {
      issues.push(`Repository migration ${index + 1} has an invalid timestamp`);
    }
    if (!isSha256(migration.hash)) {
      issues.push(`Repository migration ${index + 1} has an invalid hash`);
    }
    if (index > 0 && migration.createdAt <= repository[index - 1].createdAt) {
      issues.push("Repository migration timestamps must be unique and strictly increasing");
      break;
    }
  }

  if (!input.migrationDatabaseIdentity) {
    issues.push("Migration database identity is missing or invalid");
  }
  if (!input.runtimeDatabaseIdentity) {
    issues.push("Production runtime database identity is missing or invalid");
  }
  if (
    input.migrationDatabaseIdentity
    && input.runtimeDatabaseIdentity
    && input.migrationDatabaseIdentity !== input.runtimeDatabaseIdentity
  ) {
    issues.push("Migration and production runtime DSNs do not identify the same database");
  }

  if (!input.tableExists) {
    issues.push("Drizzle migration ledger is missing or is not an ordinary table");
    return issues;
  }
  if (input.ledgerRows.length === 0) {
    issues.push("Drizzle migration ledger is empty");
    return issues;
  }
  if (input.ledgerRows.length > repository.length) {
    issues.push("Database contains more migrations than this release candidate");
  }

  for (let index = 0; index < input.ledgerRows.length; index += 1) {
    const row = input.ledgerRows[index];
    const validIdentity = Boolean(
      row.id && row.createdAt !== null && Number.isSafeInteger(row.createdAt),
    );
    const validHash = Boolean(row.hash && isSha256(row.hash));
    if (!validIdentity) {
      issues.push(`Ledger row ${index + 1} has an invalid id or timestamp`);
    }
    if (!validHash) {
      issues.push(`Ledger row ${index + 1} has an invalid hash`);
    }
    if (index > 0 && row.createdAt <= (input.ledgerRows[index - 1].createdAt ?? -1)) {
      issues.push("Ledger timestamps must be unique and strictly increasing");
      break;
    }
    const expected = repository[index];
    if (
      validIdentity
      && validHash
      && (!expected || row.createdAt !== expected.createdAt || row.hash !== expected.hash)
    ) {
      issues.push(`Ledger row ${index + 1} does not match the repository migration prefix`);
    }
  }

  if (input.requireComplete && input.ledgerRows.length !== repository.length) {
    issues.push(
      `Migration ledger is not complete (${input.ledgerRows.length}/${repository.length} applied)`,
    );
  }
  return [...new Set(issues)];
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function fingerprint(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export function databaseResourceId(identity: string): string {
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

if (import.meta.main) {
  config({ path: ".env" });
  const requireComplete = process.argv.includes("--require-complete");
  const connectionString = resolveServerDsn(process.env, {
    isMigration: true,
    isExplicitLocalDev: isExplicitLocalDev(process.env),
  });
  const runtimeConnectionString = resolveDatabaseUrl(process.env);
  const migrationDatabaseIdentity = databaseIdentity(connectionString);
  const runtimeDatabaseIdentity = runtimeConnectionString
    ? databaseIdentity(runtimeConnectionString)
    : null;
  const repositoryMigrations = readMigrationFiles({
    migrationsFolder: "src/lib/db/migrations",
  }).map((migration) => ({
    createdAt: migration.folderMillis,
    hash: migration.hash,
  }));
  const sql = postgres(connectionString, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    max_lifetime: 30,
    onnotice: () => undefined,
  });
  try {
    await sql.begin("isolation level repeatable read read only", async (tx) => {
      const [relation] = await tx<[{ relationKind: string | null }]>`
        SELECT c.relkind::text AS "relationKind"
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'drizzle' AND c.relname = '__drizzle_migrations'
      `;
      const tableExists = relation?.relationKind === "r";
      const ledgerRows = tableExists
        ? await tx<Array<{ id: string; createdAt: string | null; hash: string | null }>>`
            SELECT id::text AS id, created_at::text AS "createdAt", lower(hash) AS hash
            FROM drizzle.__drizzle_migrations
            ORDER BY created_at ASC NULLS FIRST, id ASC
          `
        : [];
      const normalizedRows: MigrationLedgerRow[] = ledgerRows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt === null ? null : Number(row.createdAt),
        hash: row.hash,
      }));
      const issues = collectMigrationLedgerIssues({
        tableExists,
        ledgerRows: normalizedRows,
        repositoryMigrations,
        requireComplete,
        migrationDatabaseIdentity,
        runtimeDatabaseIdentity,
      });
      if (issues.length > 0) {
        console.error("Database preflight failed:");
        for (const issue of issues) console.error(`  - ${issue}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `Database ledger ${requireComplete ? "complete" : "prefix"} preflight passed `
        + `(${normalizedRows.length}/${repositoryMigrations.length} applied; `
        + `target ${fingerprint(migrationDatabaseIdentity!)}).`,
      );
      console.log(`Database resource marker: ${databaseResourceId(migrationDatabaseIdentity!)}`);
      const githubOutput = process.env.GITHUB_OUTPUT?.trim();
      if (githubOutput) {
        appendFileSync(
          githubOutput,
          `database_resource_id=${databaseResourceId(migrationDatabaseIdentity!)}\n`,
        );
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
