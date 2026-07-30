import { describe, expect, test } from "bun:test";

import {
  collectReleaseEnvironmentIsolationIssues,
  parseDotenv,
} from "./release-env-isolation";

const preview = {
  MURMUR_DEPLOYMENT_ENV: "preview",
  DATABASE_URL: "postgresql://preview:secret@preview-db.example/murmur_preview",
  MURMUR_STORAGE_S3_BUCKET: "murmur-preview",
  MURMUR_STORAGE_S3_ACCESS_KEY_ID: "preview-key",
  MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: "preview-secret",
  AUDIO_WORKER_URL: "https://audio-preview.example/v1",
  AUDIO_WORKER_TOKEN: "preview-audio-token",
  RUNPOD_SERVERLESS_ENDPOINT_ID: "preview-endpoint",
  RUNPOD_API_KEY: "preview-runpod-key",
};

const production = {
  MURMUR_DEPLOYMENT_ENV: "production",
  POSTGRES_URL: "postgresql://production:secret@production-db.example/murmur",
  MURMUR_STORAGE_S3_BUCKET: "murmur-production",
  MURMUR_STORAGE_S3_ACCESS_KEY_ID: "production-key",
  MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: "production-secret",
  AUDIO_WORKER_URL: "https://audio.example/v1",
  AUDIO_WORKER_TOKEN: "production-audio-token",
  RUNPOD_SERVERLESS_ENDPOINT_ID: "production-endpoint",
  RUNPOD_API_KEY: "production-runpod-key",
};

describe("release environment isolation", () => {
  test("accepts independently pulled and isolated resources", () => {
    expect(collectReleaseEnvironmentIsolationIssues(preview, production)).toEqual([]);
  });

  test("rejects shared resource identities without comparing redacted credentials", () => {
    const issues = collectReleaseEnvironmentIsolationIssues(
      {
        ...preview,
        DATABASE_URL: production.POSTGRES_URL,
        MURMUR_STORAGE_S3_BUCKET: production.MURMUR_STORAGE_S3_BUCKET,
        MURMUR_STORAGE_S3_ACCESS_KEY_ID: production.MURMUR_STORAGE_S3_ACCESS_KEY_ID,
        AUDIO_WORKER_URL: production.AUDIO_WORKER_URL,
        AUDIO_WORKER_TOKEN: production.AUDIO_WORKER_TOKEN,
        RUNPOD_SERVERLESS_ENDPOINT_ID: production.RUNPOD_SERVERLESS_ENDPOINT_ID,
      },
      production,
    );
    expect(issues).toEqual([
      "Preview database must differ from Production",
      "Preview storage bucket must differ from Production",
      "Preview audio Worker endpoint must differ from Production",
      "Preview music Worker endpoint must differ from Production",
    ]);
    expect(issues.join(" ")).not.toContain("production-audio-token");
  });

  test("accepts Vercel's redacted sensitive placeholders when records exist", () => {
    const redacted = "[SENSITIVE]";
    expect(collectReleaseEnvironmentIsolationIssues(
      {
        ...preview,
        MURMUR_STORAGE_S3_ACCESS_KEY_ID: redacted,
        MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: redacted,
        AUDIO_WORKER_TOKEN: redacted,
        RUNPOD_API_KEY: redacted,
      },
      {
        ...production,
        MURMUR_STORAGE_S3_ACCESS_KEY_ID: redacted,
        MURMUR_STORAGE_S3_SECRET_ACCESS_KEY: redacted,
        AUDIO_WORKER_TOKEN: redacted,
        RUNPOD_API_KEY: redacted,
      },
    )).toEqual([]);
  });

  test("parses Vercel-style quoted dotenv files", () => {
    expect(parseDotenv('A="one=two"\nexport B=three\n# ignored\nC="line\\nnext"\n')).toEqual({
      A: "one=two",
      B: "three",
      C: "line\nnext",
    });
  });
});
