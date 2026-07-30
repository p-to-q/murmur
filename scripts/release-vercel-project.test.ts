import { describe, expect, test } from "bun:test";

import {
  collectVercelProjectIssues,
  RELEASE_RESOURCE_IDENTITIES,
  type VercelEnvRecord,
} from "./release-vercel-project";

const credentials = [
  "MURMUR_STORAGE_S3_ACCESS_KEY_ID",
  "MURMUR_STORAGE_S3_SECRET_ACCESS_KEY",
  "AUDIO_WORKER_TOKEN",
  "RUNPOD_API_KEY",
];

function envs(): VercelEnvRecord[] {
  return [
    ...RELEASE_RESOURCE_IDENTITIES.flatMap((key) => [
      { id: `env_preview_${key}`, key, value: `preview-${key}`, type: "plain", target: ["preview"] as const },
      { id: `env_production_${key}`, key, value: `production-${key}`, type: "plain", target: ["production"] as const },
    ]),
    ...credentials.flatMap((key) => [
      { id: `env_preview_${key}`, key, type: "sensitive", target: ["preview"] as const },
      { id: `env_production_${key}`, key, type: "sensitive", target: ["production"] as const },
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
});
