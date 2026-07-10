import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { collectEnvWarnings, register } from "@/instrumentation";

// register() reads process.env at call time; snapshot and restore the keys we
// touch so cases don't leak into each other (or into other suites).
const KEYS = [
  "NODE_ENV",
  "NEXT_RUNTIME",
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "MURMUR_APP_URL",
  "MURMUR_AUTH_MODE",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const FULL_PROD_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://db.example/murmur",
  AUTH_SECRET: "auth-secret",
  CRON_SECRET: "cron-secret",
  MURMUR_APP_URL: "https://murmur.example",
  MURMUR_AUTH_MODE: "production",
} satisfies Record<string, string>;

describe("collectEnvWarnings", () => {
  it("is silent for a fully configured production env", () => {
    expect(collectEnvWarnings(FULL_PROD_ENV)).toEqual([]);
  });

  it("flags every soft-required variable missing in production", () => {
    const warnings = collectEnvWarnings({ NODE_ENV: "production" });
    const flagged = warnings.join("\n");
    expect(flagged).toContain("DATABASE_URL");
    expect(flagged).toContain("AUTH_SECRET");
    expect(flagged).toContain("CRON_SECRET");
    expect(flagged).toContain("MURMUR_APP_URL");
    expect(flagged).toContain("MURMUR_AUTH_MODE");
  });

  it("treats unset MURMUR_AUTH_MODE as the safe strict default, not an error", () => {
    const warnings = collectEnvWarnings({
      ...FULL_PROD_ENV,
      MURMUR_AUTH_MODE: undefined,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('defaulting to the strict "production" auth mode');
  });

  it("flags a non-production auth mode while NODE_ENV=production", () => {
    const warnings = collectEnvWarnings({
      ...FULL_PROD_ENV,
      MURMUR_AUTH_MODE: "local",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MURMUR_AUTH_MODE="local"');
  });

  it("only requires DATABASE_URL outside production", () => {
    expect(collectEnvWarnings({ NODE_ENV: "development" })).toHaveLength(1);
    expect(
      collectEnvWarnings({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://localhost/murmur",
      }),
    ).toEqual([]);
  });
});

describe("register", () => {
  it("warns loudly but never throws for a bare production env", async () => {
    process.env.NODE_ENV = "production";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Preview deployments run NODE_ENV=production without the full prod
      // env — startup validation must degrade to a warning, never a crash.
      await register();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("[murmur:instrumentation]");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays quiet when everything is configured", async () => {
    for (const [key, value] of Object.entries(FULL_PROD_ENV)) {
      process.env[key] = value;
    }
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await register();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("skips validation outside the Node.js runtime", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_RUNTIME = "edge";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await register();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
