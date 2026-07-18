import { describe, expect, it } from "bun:test";

import { collectUrlEnvAuditIssues } from "./env-audit";

describe("production URL env audit", () => {
  it("accepts supported absolute URLs", () => {
    expect(collectUrlEnvAuditIssues({
      DATABASE_URL: "postgresql://user:pass@example.neon.tech/db",
      AUTH_URL: "https://murmur.example",
      AUDIO_WORKER_URL: "https://audio.example",
      MURMUR_STORAGE_S3_PUBLIC_URL_BASE: "https://cdn.example/audio",
    })).toEqual([]);
  });

  it("names malformed values without exposing them", () => {
    expect(collectUrlEnvAuditIssues({
      DATABASE_URL: "[SENSITIVE]",
      MURMUR_APP_URL: "murmur.example",
    })).toEqual([
      "DATABASE_URL must be a valid absolute URL",
      "MURMUR_APP_URL must be a valid absolute URL",
    ]);
  });

  it("rejects valid URLs with unsafe protocols", () => {
    expect(collectUrlEnvAuditIssues({
      DATABASE_URL: "https://db.example",
      AUTH_URL: "file:///tmp/auth",
    })).toEqual([
      "DATABASE_URL must use postgres: or postgresql:",
      "AUTH_URL must use http: or https:",
    ]);
  });
});
