import { describe, expect, it } from "bun:test";

import {
  classifyDatabaseHostname,
  collectDatabaseEnvAuditIssues,
  DEFAULT_DB_POOL_MAX,
  isExplicitLocalDev,
  LOCAL_DEV_FALLBACK_DSN,
  resolveDatabaseUrl,
  resolveDbPoolMax,
  resolveServerDsn,
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

  it("reports a missing runtime DSN as an audit issue", () => {
    expect(collectDatabaseEnvAuditIssues({})).toEqual([
      expect.stringContaining("DATABASE_URL or POSTGRES_URL must be set"),
    ]);
    expect(collectDatabaseEnvAuditIssues({ DATABASE_URL: "   " })).toEqual([
      expect.stringContaining("DATABASE_URL or POSTGRES_URL must be set"),
    ]);
    // A configured DSN produces no missing-DSN issue.
    expect(
      collectDatabaseEnvAuditIssues({
        POSTGRES_URL: "postgresql://user:pass@db.example.com/murmur",
      }),
    ).toEqual([]);
  });
});

describe("resolveServerDsn precedence contract", () => {
  it("uses runtime precedence (DATABASE_URL over POSTGRES_URL) and trims", () => {
    expect(
      resolveServerDsn({
        DATABASE_URL: " postgres://primary.example/murmur ",
        POSTGRES_URL: "postgres://fallback.example/murmur",
      }),
    ).toBe("postgres://primary.example/murmur");

    expect(
      resolveServerDsn({
        DATABASE_URL: "   ",
        POSTGRES_URL: " postgres://fallback.example/murmur ",
      }),
    ).toBe("postgres://fallback.example/murmur");
  });

  it("ignores the unpooled vars in runtime mode", () => {
    expect(
      resolveServerDsn({
        DATABASE_URL_UNPOOLED: "postgres://direct.example/murmur",
        POSTGRES_URL_NON_POOLING: "postgres://direct2.example/murmur",
        DATABASE_URL: "postgres://pooled.example/murmur",
      }),
    ).toBe("postgres://pooled.example/murmur");
  });

  it("prefers the explicit unpooled endpoint in migration mode", () => {
    const env = {
      DATABASE_URL_UNPOOLED: "postgres://unpooled.example/murmur",
      POSTGRES_URL_NON_POOLING: "postgres://non-pooling.example/murmur",
      DATABASE_URL: "postgres://pooled.example/murmur",
      POSTGRES_URL: "postgres://vercel.example/murmur",
    };
    expect(resolveServerDsn(env, { isMigration: true })).toBe(
      "postgres://unpooled.example/murmur",
    );
  });

  it("walks the full migration precedence chain as vars drop out", () => {
    const base = {
      DATABASE_URL_UNPOOLED: "postgres://unpooled.example/murmur",
      POSTGRES_URL_NON_POOLING: "postgres://non-pooling.example/murmur",
      DATABASE_URL: "postgres://pooled.example/murmur",
      POSTGRES_URL: "postgres://vercel.example/murmur",
    };
    const opts = { isMigration: true };

    expect(
      resolveServerDsn({ ...base, DATABASE_URL_UNPOOLED: undefined }, opts),
    ).toBe("postgres://non-pooling.example/murmur");
    expect(
      resolveServerDsn(
        {
          ...base,
          DATABASE_URL_UNPOOLED: undefined,
          POSTGRES_URL_NON_POOLING: undefined,
        },
        opts,
      ),
    ).toBe("postgres://pooled.example/murmur");
    expect(
      resolveServerDsn(
        {
          DATABASE_URL_UNPOOLED: "  ",
          POSTGRES_URL_NON_POOLING: "",
          DATABASE_URL: undefined,
          POSTGRES_URL: "postgres://vercel.example/murmur",
        },
        opts,
      ),
    ).toBe("postgres://vercel.example/murmur");
  });
});

describe("resolveServerDsn fail-closed behavior", () => {
  it("throws — never returns localhost — when no DSN and not explicit local dev", () => {
    expect(() =>
      resolveServerDsn({}, { isExplicitLocalDev: false }),
    ).toThrow("No database connection string is set");

    // The error must name the accepted vars and refuse the localhost default.
    let message = "";
    try {
      resolveServerDsn({}, { isMigration: true, isExplicitLocalDev: false });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL_UNPOOLED");
    expect(message).toContain("POSTGRES_URL_NON_POOLING");
    expect(message).toContain("localhost");
    expect(message).not.toBe(LOCAL_DEV_FALLBACK_DSN);
  });

  it("falls back to the local dev DSN only when explicitly signalled", () => {
    expect(resolveServerDsn({}, { isExplicitLocalDev: true })).toBe(
      LOCAL_DEV_FALLBACK_DSN,
    );
    expect(
      resolveServerDsn({}, { isMigration: true, isExplicitLocalDev: true }),
    ).toBe(LOCAL_DEV_FALLBACK_DSN);
  });

  it("still prefers a configured DSN over the local fallback", () => {
    expect(
      resolveServerDsn(
        { DATABASE_URL: "postgres://primary.example/murmur" },
        { isExplicitLocalDev: true },
      ),
    ).toBe("postgres://primary.example/murmur");
  });
});

describe("isExplicitLocalDev signal", () => {
  it("treats development and test runtimes as local dev", () => {
    expect(isExplicitLocalDev({ NODE_ENV: "development" })).toBe(true);
    expect(isExplicitLocalDev({ NODE_ENV: "test" })).toBe(true);
  });

  it("never treats production as local dev, even with the opt-in flag", () => {
    expect(isExplicitLocalDev({ NODE_ENV: "production" })).toBe(false);
    expect(
      isExplicitLocalDev({
        NODE_ENV: "production",
        MURMUR_DB_ALLOW_LOCAL_FALLBACK: "1",
      }),
    ).toBe(false);
  });

  it("requires an explicit opt-in when NODE_ENV is unset or unknown", () => {
    expect(isExplicitLocalDev({})).toBe(false);
    expect(isExplicitLocalDev({ NODE_ENV: "staging" })).toBe(false);

    for (const value of ["1", "true", "yes", "TRUE", " Yes "]) {
      expect(
        isExplicitLocalDev({ MURMUR_DB_ALLOW_LOCAL_FALLBACK: value }),
      ).toBe(true);
    }
    for (const value of ["0", "false", "no", ""]) {
      expect(
        isExplicitLocalDev({ MURMUR_DB_ALLOW_LOCAL_FALLBACK: value }),
      ).toBe(false);
    }
  });
});
