import { describe, expect, test } from "bun:test";

import { collectPreviewProvenanceIssues } from "./release-verify-preview";

const previewSha = "a".repeat(40);
const releaseSha = "b".repeat(40);

function issues(overrides: Record<string, unknown> = {}) {
  return collectPreviewProvenanceIssues({
    pullRequest: {
      number: 440,
      state: "closed",
      merged_at: "2026-07-30T10:00:00Z",
      merge_commit_sha: releaseSha,
      base: { ref: "main" },
      head: { ref: "codex/release-0.7.0-rc.2", sha: previewSha },
    },
    statuses: {
      statuses: [{
        context: "Vercel",
        state: "success",
        target_url: "https://vercel.com/moapachas-projects/murmur/preview123",
      }],
    },
    previewCommit: { commit: { tree: { sha: "c".repeat(40) } } },
    releaseCommit: { commit: { tree: { sha: "c".repeat(40) } } },
    deployment: {
      id: "dpl_preview123",
      name: "murmur",
      readyState: "READY",
      target: null,
      meta: {
        githubCommitSha: previewSha,
        githubCommitRef: "codex/release-0.7.0-rc.2",
      },
    },
    expectedPr: 440,
    expectedBranch: "codex/release-0.7.0-rc.2",
    expectedPreviewSha: previewSha,
    expectedReleaseSha: releaseSha,
    expectedScope: "moapachas-projects",
    expectedProject: "murmur",
    ...overrides,
  });
}

describe("release Preview provenance", () => {
  test("accepts the exact successful merged Preview", () => {
    expect(issues()).toEqual([]);
  });

  test("rejects an unmerged or unrelated PR", () => {
    expect(issues({
      pullRequest: {
        number: 441,
        state: "open",
        merged_at: null,
        merge_commit_sha: previewSha,
        base: { ref: "other" },
        head: { ref: "other", sha: releaseSha },
      },
    })).toEqual([
      "Preview PR number mismatch",
      "Preview PR must be merged",
      "Preview PR must target main",
      "Preview PR branch mismatch",
      "Preview PR head SHA mismatch",
      "Preview PR merge commit does not equal the release SHA",
    ]);
  });

  test("rejects failed, missing, or ambiguous Vercel status", () => {
    expect(issues({ statuses: { statuses: [] } })).toEqual([
      "Preview SHA must have one successful Vercel deployment status",
    ]);
    expect(issues({ statuses: { statuses: [
      { context: "Vercel", state: "failure", target_url: "https://vercel.com/fail" },
      { context: "Vercel", state: "success", target_url: "https://vercel.com/pass" },
    ] } })).toEqual([
      "Preview SHA must have one successful Vercel deployment status",
    ]);
  });

  test("rejects a different tree or unverifiable Vercel deployment", () => {
    expect(issues({
      releaseCommit: { commit: { tree: { sha: "d".repeat(40) } } },
      deployment: {
        id: "dpl_other",
        name: "other",
        readyState: "BUILDING",
        target: "production",
        meta: { githubCommitSha: releaseSha, githubCommitRef: "main" },
      },
    })).toEqual([
      "Preview and release commits must have identical Git trees",
      "Vercel Preview deployment identity, readiness, or Git metadata mismatch",
    ]);
  });
});
