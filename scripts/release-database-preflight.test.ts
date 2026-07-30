import { describe, expect, test } from "bun:test";

import {
  collectMigrationLedgerIssues,
  databaseResourceId,
  type MigrationLedgerRow,
  type RepositoryMigration,
} from "./release-database-preflight";

const repositoryMigrations: RepositoryMigration[] = [
  { createdAt: 100, hash: "a".repeat(64) },
  { createdAt: 200, hash: "b".repeat(64) },
  { createdAt: 300, hash: "c".repeat(64) },
];

function rows(...indexes: number[]): MigrationLedgerRow[] {
  return indexes.map((index) => ({
    id: String(index + 1),
    createdAt: repositoryMigrations[index].createdAt,
    hash: repositoryMigrations[index].hash,
  }));
}

function issues(overrides: Partial<Parameters<typeof collectMigrationLedgerIssues>[0]> = {}) {
  return collectMigrationLedgerIssues({
    tableExists: true,
    ledgerRows: rows(0, 1),
    repositoryMigrations,
    migrationDatabaseIdentity: "db.example:5432/murmur",
    runtimeDatabaseIdentity: "db.example:5432/murmur",
    ...overrides,
  });
}

describe("release database preflight", () => {
  test("derives a stable opaque Vercel resource marker", () => {
    expect(databaseResourceId("postgres.example:5432/murmur")).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(databaseResourceId("postgres.example:5432/murmur")).not.toBe(
      databaseResourceId("postgres.example:5432/preview"),
    );
  });

  test("accepts a non-empty exact prefix and requires completeness only after migration", () => {
    expect(issues()).toEqual([]);
    expect(issues({ requireComplete: true })).toEqual([
      "Migration ledger is not complete (2/3 applied)",
    ]);
    expect(issues({ ledgerRows: rows(0, 1, 2), requireComplete: true })).toEqual([]);
  });

  test("fails closed on a missing or empty ledger", () => {
    expect(issues({ tableExists: false, ledgerRows: [] })).toContain(
      "Drizzle migration ledger is missing or is not an ordinary table",
    );
    expect(issues({ ledgerRows: [] })).toContain("Drizzle migration ledger is empty");
  });

  test("rejects gaps, unknown history, hash drift, nulls, and future rows", () => {
    expect(issues({ ledgerRows: rows(0, 2) })).toContain(
      "Ledger row 2 does not match the repository migration prefix",
    );
    expect(issues({ ledgerRows: [rows(0)[0], { id: "2", createdAt: 150, hash: "d".repeat(64) }] })).toContain(
      "Ledger row 2 does not match the repository migration prefix",
    );
    expect(issues({ ledgerRows: [{ ...rows(0)[0], hash: "f".repeat(64) }] })).toContain(
      "Ledger row 1 does not match the repository migration prefix",
    );
    expect(issues({ ledgerRows: [{ id: "1", createdAt: null, hash: null }] })).toEqual(
      expect.arrayContaining([
        "Ledger row 1 has an invalid id or timestamp",
        "Ledger row 1 has an invalid hash",
      ]),
    );
    expect(issues({
      ledgerRows: [...rows(0, 1, 2), { id: "4", createdAt: 400, hash: "d".repeat(64) }],
    })).toEqual(expect.arrayContaining([
      "Database contains more migrations than this release candidate",
      "Ledger row 4 does not match the repository migration prefix",
    ]));
  });

  test("rejects malformed repository history and a mismatched production target", () => {
    expect(issues({
      repositoryMigrations: [
        { createdAt: 200, hash: "bad" },
        { createdAt: 100, hash: "b".repeat(64) },
      ],
      runtimeDatabaseIdentity: "other.example:5432/murmur",
    })).toEqual(expect.arrayContaining([
      "Repository migration 1 has an invalid hash",
      "Repository migration timestamps must be unique and strictly increasing",
      "Migration and production runtime DSNs do not identify the same database",
    ]));
  });
});
