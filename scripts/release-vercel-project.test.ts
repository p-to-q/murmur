import { describe, expect, test } from "bun:test";

import {
  collectVercelProjectIssues,
  productionReleaseResourceFingerprint,
  RELEASE_RESOURCE_IDENTITIES,
  type VercelEnvRecord,
} from "./release-vercel-project";
import { releaseResourceFingerprint } from "../src/lib/platform/release-resource-fingerprint";

const credentials = [
  "MURMUR_STORAGE_S3_ACCESS_KEY_ID",
  "MURMUR_STORAGE_S3_SECRET_ACCESS_KEY",
  "AUDIO_WORKER_TOKEN",
  "RUNPOD_API_KEY",
];

function envs(): VercelEnvRecord[] {
  const resourceIdentity = (
    key: (typeof RELEASE_RESOURCE_IDENTITIES)[number],
    target: "preview" | "production",
  ) => {
    if (key === "MURMUR_AUDIO_WORKER_RESOURCE_ID") {
      return `https://audio.${target}.example`;
    }
    if (key === "MURMUR_MUSIC_WORKER_RESOURCE_ID") {
      return `${target}-music-endpoint`;
    }
    return `${target}-${key}`;
  };
  return [
    ...RELEASE_RESOURCE_IDENTITIES.flatMap((key) => [
      { id: `env_preview_${key}`, key, value: resourceIdentity(key, "preview"), type: "plain", target: ["preview"] as const },
      { id: `env_production_${key}`, key, value: resourceIdentity(key, "production"), type: "plain", target: ["production"] as const },
    ]),
    {
      id: "env_preview_storage_driver",
      key: "MURMUR_STORAGE_DRIVER",
      value: "s3-compatible",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_storage_driver",
      key: "MURMUR_STORAGE_DRIVER",
      value: "s3-compatible",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_preview_storage_bucket",
      key: "MURMUR_STORAGE_S3_BUCKET",
      value: "murmur-preview",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_storage_bucket",
      key: "MURMUR_STORAGE_S3_BUCKET",
      value: "murmur-production",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_preview_storage_region",
      key: "MURMUR_STORAGE_S3_REGION",
      value: "auto",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_storage_region",
      key: "MURMUR_STORAGE_S3_REGION",
      value: "auto",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_production_music_revision",
      key: "MURMUR_MUSIC_RELEASE_SHA",
      value: "a".repeat(40),
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_production_music_quality_evidence",
      key: "MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED",
      value: "1",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_production_music_v2_evidence",
      key: "MURMUR_MUSIC_V2_EVIDENCE_REQUIRED",
      value: "1",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_preview_audio_worker_url",
      key: "AUDIO_WORKER_URL",
      value: "https://audio.preview.example/",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_audio_worker_url",
      key: "AUDIO_WORKER_URL",
      value: "https://audio.production.example/",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_preview_runpod_endpoint",
      key: "RUNPOD_SERVERLESS_ENDPOINT_ID",
      value: "preview-music-endpoint",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_runpod_endpoint",
      key: "RUNPOD_SERVERLESS_ENDPOINT_ID",
      value: "production-music-endpoint",
      type: "plain",
      target: ["production"] as const,
    },
    {
      id: "env_preview_music_mode",
      key: "MUSIC_ENGINE_MODE",
      value: "serverless",
      type: "plain",
      target: ["preview"] as const,
    },
    {
      id: "env_production_music_mode",
      key: "MUSIC_ENGINE_MODE",
      value: "serverless",
      type: "plain",
      target: ["production"] as const,
    },
    ...credentials.flatMap((key) => [
      { id: `env_preview_${key}`, key, type: "sensitive", target: ["preview"] as VercelEnvRecord["target"] },
      { id: `env_production_${key}`, key, type: "sensitive", target: ["production"] as VercelEnvRecord["target"] },
    ]),
  ];
}

function collect(records = envs(), overrides: Record<string, unknown> = {}) {
  return collectVercelProjectIssues({
    project: { name: "murmur", link: { type: "github", org: "p-to-q", repo: "murmur", productionBranch: "main" } },
    rollingConfig: { rollingRelease: null },
    rollingRelease: { rollingRelease: null },
    envs: records,
    expectedProject: "murmur",
    expectedOrg: "p-to-q",
    expectedRepo: "murmur",
    ...overrides,
  });
}

describe("Vercel release project preflight", () => {
  test("accepts isolated resources, scoped credentials, and disabled rolling releases", () => {
    expect(collect()).toEqual([]);
  });

  test("derives a stable Production fingerprint from only bounded plain identities", () => {
    const records = envs();
    const expectedEnvironment = Object.fromEntries(
      records
        .filter((record) => record.target?.includes("production") && record.type === "plain")
        .map((record) => [record.key, record.value]),
    );
    const fingerprint = productionReleaseResourceFingerprint(records);

    expect(fingerprint).toBe(releaseResourceFingerprint(expectedEnvironment));
    records.find((record) => record.id === "env_production_RUNPOD_API_KEY")!.value = "secret-drift";
    expect(productionReleaseResourceFingerprint(records)).toBe(fingerprint);
    records.find((record) => record.key === "RUNPOD_SERVERLESS_ENDPOINT_ID"
      && record.target?.includes("production"))!.value = "new-production-endpoint";
    expect(productionReleaseResourceFingerprint(records)).not.toBe(fingerprint);
  });

  test("rejects project drift and active or configured rolling releases", () => {
    expect(collect(envs(), {
      project: { name: "other", link: { type: "github", org: "p-to-q", repo: "other", productionBranch: "develop" } },
      rollingConfig: { rollingRelease: { target: "production" } },
      rollingRelease: { rollingRelease: { state: "ACTIVE" } },
    })).toEqual([
      "Vercel project identity mismatch",
      "Vercel Git link must target the expected GitHub repository with main as production branch",
      "Vercel Rolling Releases must be disabled for future deployments",
      "An active Vercel Rolling Release must be resolved before release",
    ]);
  });

  test("rejects shared resource markers and cross-environment credential records", () => {
    const records = envs();
    const previewDb = records.find((record) => record.id === "env_preview_MURMUR_DATABASE_RESOURCE_ID")!;
    previewDb.value = "production-MURMUR_DATABASE_RESOURCE_ID";
    const shared = records.find((record) => record.id === "env_preview_RUNPOD_API_KEY")!;
    shared.target = ["preview", "production"];
    const productionIndex = records.findIndex((record) => record.id === "env_production_RUNPOD_API_KEY");
    records.splice(productionIndex, 1);
    expect(collect(records)).toEqual([
      "Preview MURMUR_DATABASE_RESOURCE_ID must differ from Production",
      "RUNPOD_API_KEY must not use one Vercel record for Preview and Production",
    ]);
  });

  test("uses a branch-specific Preview override when present", () => {
    const records = envs();
    records.push({
      id: "env_branch_database",
      key: "MURMUR_DATABASE_RESOURCE_ID",
      value: "branch-database",
      type: "plain",
      target: ["preview"],
      gitBranch: "codex/release",
    });
    expect(collect(records, { previewBranch: "codex/release" })).toEqual([]);
  });

  test("rejects a missing or mutable production Worker revision", () => {
    const records = envs();
    const revision = records.find((record) => record.id === "env_production_music_revision")!;
    revision.value = "latest";
    expect(collect(records)).toContain(
      "Production MURMUR_MUSIC_RELEASE_SHA must be one plain immutable Worker SHA",
    );
  });

  test("requires production to fail closed on Worker receipt evidence", () => {
    const records = envs();
    records.find(
      (record) => record.key === "MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED",
    )!.value = "0";
    const v2Index = records.findIndex(
      (record) => record.key === "MURMUR_MUSIC_V2_EVIDENCE_REQUIRED",
    );
    records.splice(v2Index, 1);

    expect(collect(records)).toEqual([
      "Production MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED must be one plain value set to 1",
      "Production MURMUR_MUSIC_V2_EVIDENCE_REQUIRED must be one plain value set to 1",
    ]);
  });

  test("binds Vercel music markers to the protected canary identity", () => {
    expect(collect(envs(), {
      expectedMusicWorkerResourceId: "wrong-endpoint",
      expectedMusicWorkerSha: "b".repeat(40),
    })).toEqual(expect.arrayContaining([
      "Production music resource marker must equal the canary endpoint id",
      "Production Worker revision marker must equal the canary Worker SHA",
      "Production RunPod endpoint must equal the canary endpoint id",
    ]));
  });

  test("binds the actual production transport to the canaried endpoint", () => {
    const records = envs();
    records.find((record) => record.key === "MUSIC_ENGINE_MODE"
      && record.target?.includes("production"))!.value = "http";
    records.find(
      (record) => record.key === "RUNPOD_SERVERLESS_ENDPOINT_ID"
        && record.target?.includes("production"),
    )!.value = "uncanaried-endpoint";

    expect(collect(records, {
      expectedMusicWorkerResourceId: "production-music-endpoint",
    })).toEqual([
      "Production MUSIC_ENGINE_MODE must select the canaried serverless transport",
      "Production RunPod endpoint must equal the Production music resource marker",
      "Production RunPod endpoint must equal the canary endpoint id",
    ]);
  });

  test("binds Preview runtime transport to its Preview resource markers", () => {
    const records = envs();
    records.find((record) => record.id === "env_preview_music_mode")!.value = "http";
    records.find((record) => record.id === "env_preview_runpod_endpoint")!.value = "other-endpoint";
    records.find((record) => record.id === "env_preview_audio_worker_url")!.value = "https://other-audio.example";

    expect(collect(records)).toEqual([
      "Preview MUSIC_ENGINE_MODE must select the serverless transport",
      "Preview RunPod endpoint must equal the Preview music resource marker",
      "Preview AUDIO_WORKER_URL must equal the Preview Audio Worker resource marker",
    ]);
  });

  test("requires durable and isolated Preview/Production storage targets", () => {
    const records = envs();
    records.find((record) => record.id === "env_preview_storage_driver")!.value = "memory";
    records.find((record) => record.id === "env_preview_storage_bucket")!.value =
      "murmur-production";

    expect(collect(records)).toEqual([
      "Preview MURMUR_STORAGE_DRIVER must select durable s3-compatible storage",
      "Preview storage bucket must differ from Production",
    ]);
  });

  test("binds database and Audio Worker markers to observed production resources", () => {
    expect(collect(envs(), {
      expectedDatabaseResourceId: "wrong-database",
      expectedAudioWorkerResourceId: "https://other-audio.example",
    })).toEqual(expect.arrayContaining([
      "Production database resource marker must equal the verified database identity",
      "Production Audio Worker resource marker must equal the health-checked origin",
      "Production AUDIO_WORKER_URL must equal the health-checked origin",
    ]));
  });

  test("rejects readable credentials", () => {
    const records = envs();
    records.find((record) => record.id === "env_production_RUNPOD_API_KEY")!.type = "plain";
    expect(collect(records)).toContain(
      "Production RUNPOD_API_KEY must have one sensitive environment-scoped Vercel record",
    );
  });
});
