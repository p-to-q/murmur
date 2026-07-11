import { describe, expect, it } from "bun:test";

import {
  classifyDatabaseHostname,
  collectDatabaseEnvAuditIssues,
  DEFAULT_DB_POOL_MAX,
  resolveDatabaseUrl,
  resolveDbPoolMax,
} from "./config";

describe("database connection config", () => {
  it("recognizes current and legacy Neon pooler hostnames", () => {
    expect(
      classifyDatabaseHostname(
        "postgresql://user:pass@ep-cool-frog-pooler.us-east-2.aws.neon.tech/murmur",
      ),
    ).toBe("neon-pooler");
    expect(
      classifyDatabaseHostname(
        "postgresql://user:pass@project-pooler.neon.tech/murmur",
      ),
    ).toBe("neon-pooler");
  });

  it("recognizes a direct Neon hostname", () => {
    expect(
      classifyDatabaseHostname(
        "postgresql://user:pass@ep-cool-frog.us-east-2.aws.neon.tech/murmur",
      ),
    ).toBe("neon-direct");
  });

  it("does not classify local, test, or non-Neon hosts as Neon", () => {
    expect(
      classifyDatabaseHostname("postgresql://postgres:password@localhost:5432/murmur"),
    ).toBe("other");
    expect(
      classifyDatabaseHostname("postgresql://postgres:password@127.0.0.1:5432/murmur_test"),
    ).toBe("other");
    expect(
      classifyDatabaseHostname("postgresql://user:pass@db.example.com/murmur"),
    ).toBe("other");
    expect(
      classifyDatabaseHostname(
        "postgresql://user:pass@ep-fake-pooler.neon.tech.example.com/murmur",
      ),
    ).toBe("other");
  });

  it("audits only direct Neon endpoints", () => {
    expect(
      collectDatabaseEnvAuditIssues({
        DATABASE_URL:
          "postgresql://user:pass@ep-cool-frog.us-east-2.aws.neon.tech/murmur",
        POSTGRES_URL:
          "postgresql://user:pass@ep-cool-frog-pooler.us-east-2.aws.neon.tech/murmur",
      }),
    ).toEqual([expect.stringContaining("must use a Neon pooler hostname")]);

    for (const DATABASE_URL of [
      "postgresql://user:pass@ep-cool-frog-pooler.us-east-2.aws.neon.tech/murmur",
      "postgresql://user:pass@db.example.com/murmur",
      "postgresql://postgres:password@localhost:5432/murmur",
    ]) {
      expect(collectDatabaseEnvAuditIssues({ DATABASE_URL })).toEqual([]);
    }
  });

  it("uses the same non-empty DSN precedence as the DB client", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: "  ",
        POSTGRES_URL: " postgres://fallback.example/murmur ",
      }),
    ).toBe("postgres://fallback.example/murmur");
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: " postgres://primary.example/murmur ",
        POSTGRES_URL: "postgres://fallback.example/murmur",
      }),
    ).toBe("postgres://primary.example/murmur");
  });

  it("keeps max 5 by default and accepts only a bounded integer override", () => {
    expect(resolveDbPoolMax()).toBe(DEFAULT_DB_POOL_MAX);
    expect(resolveDbPoolMax("1")).toBe(1);
    expect(resolveDbPoolMax("5")).toBe(5);
    expect(resolveDbPoolMax("10")).toBe(10);

    for (const value of ["0", "11", "1.5", "many"]) {
      expect(() => resolveDbPoolMax(value)).toThrow(
        "MURMUR_DB_POOL_MAX must be an integer from 1 to 10",
      );
    }
  });
});
