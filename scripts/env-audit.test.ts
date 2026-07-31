import { describe, expect, it } from "bun:test";

import {
  collectDurableRuntimeEnvAuditIssues,
  collectPreviewIsolationEnvAuditIssues,
  collectPreviewProvisioningEnvAuditIssues,
  collectProductionFallbackEnvAuditIssues,
  collectUrlEnvAuditIssues,
  previewRequiresFullStack,
} from "./env-audit";

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

describe("durable runtime env audit", () => {
  it("accepts a Postgres-backed production deployment with verified tmp lifecycle", () => {
    expect(collectDurableRuntimeEnvAuditIssues({
      MURMUR_DEPLOYMENT_ENV: "production",
      MURMUR_RATE_LIMIT_DRIVER: "postgres",
      MURMUR_STORAGE_TMP_LIFECYCLE_CONFIRMED: "true",
    }, "production")).toEqual([]);
  });

  it("rejects process-local production limits and unverified object expiry", () => {
    expect(collectDurableRuntimeEnvAuditIssues({
      MURMUR_DEPLOYMENT_ENV: "preview",
      MURMUR_RATE_LIMIT_DRIVER: "memory",
    }, "production")).toEqual([
      "MURMUR_DEPLOYMENT_ENV must be production on Vercel production",
      "MURMUR_RATE_LIMIT_DRIVER must be unset or postgres on Vercel production",
      "MURMUR_STORAGE_TMP_LIFECYCLE_CONFIRMED must be true after verifying a 24-hour tmp/ bucket lifecycle",
    ]);
  });
});

describe("Preview isolation env audit", () => {
  const isolated = {
    MURMUR_DEPLOYMENT_ENV: "preview",
    NODE_ENV: "production",
    MURMUR_RATE_LIMIT_DRIVER: "postgres",
    MURMUR_AUTH_MODE: "production",
    NEXT_PUBLIC_MURMUR_AUTH_MODE: "production",
    DATABASE_URL: "postgresql://user:pass@preview-pooler.neon.tech/app",
    MURMUR_STORAGE_DRIVER: "s3-compatible",
    MURMUR_STORAGE_S3_BUCKET: "murmur-preview",
    MURMUR_STORAGE_S3_REGION: "auto",
    MURMUR_STORAGE_S3_ACCESS_KEY_ID: "preview-key-id",
    MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: "preview-secret",
    MURMUR_STORAGE_S3_PUBLIC_URL_BASE: "https://preview-cdn.example.test",
    AUDIO_WORKER_URL: "https://audio-preview.example.test",
    AUDIO_WORKER_TOKEN: "preview-audio-token",
    RUNPOD_SERVERLESS_ENDPOINT_ID: "preview-endpoint",
    RUNPOD_API_KEY: "preview-runpod-key",
  };

  it("accepts an explicitly isolated resource set", () => {
    expect(collectPreviewIsolationEnvAuditIssues(isolated)).toEqual([]);
    expect(collectPreviewProvisioningEnvAuditIssues(isolated)).toEqual([]);
  });

  it("blocks on mislabelled or unsafe Preview configuration", () => {
    const issues = collectPreviewIsolationEnvAuditIssues({
      ...isolated,
      MURMUR_DEPLOYMENT_ENV: "production",
      MURMUR_RATE_LIMIT_DRIVER: "memory",
      MURMUR_ALLOW_DEV_BILLING_FALLBACK: "true",
      DATABASE_URL: "postgresql://user:pass@ep-plain.us-east-2.aws.neon.tech/app",
    });

    expect(issues).toContain(
      "MURMUR_DEPLOYMENT_ENV must be preview on Vercel preview",
    );
    expect(issues).toContain(
      "MURMUR_RATE_LIMIT_DRIVER must be unset or postgres on Vercel preview",
    );
    expect(issues).toContain(
      "MURMUR_ALLOW_DEV_BILLING_FALLBACK must be unset/false in production",
    );
    expect(issues.some((issue) => issue.includes("Neon pooler hostname"))).toBe(true);
  });

  it("reports an unprovisioned stack separately from misconfiguration", () => {
    const unprovisioned = {
      ...isolated,
      MURMUR_STORAGE_DRIVER: "",
      MURMUR_STORAGE_S3_BUCKET: "",
      MURMUR_STORAGE_S3_REGION: "",
      MURMUR_STORAGE_S3_ACCESS_KEY_ID: "",
      MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: "",
      AUDIO_WORKER_TOKEN: "",
      RUNPOD_API_KEY: "",
    };

    // A Preview that is merely unprovisioned is still safe to build and deploy.
    expect(collectPreviewIsolationEnvAuditIssues(unprovisioned)).toEqual([]);

    const provisioning = collectPreviewProvisioningEnvAuditIssues(unprovisioned);
    expect(provisioning).toContain(
      "MURMUR_STORAGE_DRIVER must be s3-compatible on Vercel preview",
    );
    expect(provisioning).toContain("MURMUR_STORAGE_S3_BUCKET is required on Vercel preview");
    expect(provisioning).toContain("AUDIO_WORKER_TOKEN is required on Vercel preview");
    expect(provisioning).toContain("RUNPOD_API_KEY is required on Vercel preview");
  });

  it("requires a public audio base until private delivery is enabled", () => {
    const issues = collectPreviewProvisioningEnvAuditIssues({
      ...isolated,
      MURMUR_STORAGE_S3_PUBLIC_URL_BASE: "",
    });
    expect(issues).toContain(
      "MURMUR_STORAGE_S3_PUBLIC_URL_BASE is required on Vercel preview until private song audio delivery is enabled",
    );
  });

  it("drops the public audio base requirement once private delivery is on", () => {
    expect(collectPreviewProvisioningEnvAuditIssues({
      ...isolated,
      MURMUR_STORAGE_S3_PUBLIC_URL_BASE: "",
      MURMUR_PRIVATE_SONG_AUDIO_DELIVERY: "1",
    })).toEqual([]);
  });

  it("promotes provisioning gaps back to blocking when the owner opts in", () => {
    expect(previewRequiresFullStack({})).toBe(false);
    expect(previewRequiresFullStack({ MURMUR_PREVIEW_REQUIRE_FULL_STACK: "0" })).toBe(false);
    expect(previewRequiresFullStack({ MURMUR_PREVIEW_REQUIRE_FULL_STACK: "1" })).toBe(true);
    expect(previewRequiresFullStack({ MURMUR_PREVIEW_REQUIRE_FULL_STACK: "true" })).toBe(true);
  });
});

describe("production fallback env audit", () => {
  it("accepts strict production auth with every local fallback disabled", () => {
    expect(collectProductionFallbackEnvAuditIssues({
      MURMUR_AUTH_MODE: "production",
      NEXT_PUBLIC_MURMUR_AUTH_MODE: "prod",
    })).toEqual([]);
  });

  it("rejects server, client, and preview fallback switches", () => {
    expect(collectProductionFallbackEnvAuditIssues({
      MURMUR_AUTH_MODE: "demo",
      NEXT_PUBLIC_MURMUR_AUTH_MODE: "local",
      MURMUR_ALLOW_DEV_BILLING_FALLBACK: "true",
      MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW: "1",
    })).toEqual([
      "MURMUR_ALLOW_DEV_BILLING_FALLBACK must be unset/false in production",
      "MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW must be unset/false in production",
      "MURMUR_AUTH_MODE must be production/prod in production",
      "NEXT_PUBLIC_MURMUR_AUTH_MODE must be unset or production/prod in production",
    ]);
  });
});
