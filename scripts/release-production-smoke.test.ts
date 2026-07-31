import { describe, expect, it } from "bun:test";

import {
  assertCanaryOperationEvidence,
  assertReleaseIdentity,
  assertMusicHealth,
  buildWorkerCanaryOperationIds,
  fetchCanaryWithRetry,
  parseReleaseIdentity,
} from "./release-production-smoke";

describe("production release smoke response parsing", () => {
  it("requires semantic music availability, not only HTTP 200", () => {
    expect(() => assertMusicHealth({ configured: true, available: true, reason: null }))
      .not.toThrow();
    expect(() => assertMusicHealth({ configured: true, available: false, reason: "unauthorized" }))
      .toThrow("music health unavailable");
  });
  it("reports the HTTP status before attempting to parse an error body", async () => {
    const response = new Response("upstream unavailable", { status: 502 });

    await expect(parseReleaseIdentity(response)).rejects.toThrow(
      "/api/release returned 502",
    );
  });

  it("parses the bounded runtime resource fingerprint", async () => {
    const response = new Response(JSON.stringify({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    }));

    await expect(parseReleaseIdentity(response)).resolves.toEqual({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    });
  });

  it("rejects a runtime resource fingerprint that differs from preflight", () => {
    expect(() => assertReleaseIdentity({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    }, {
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "c".repeat(64),
    })).toThrow("release identity mismatch");
  });
});

describe("production Worker canary operation identity", () => {
  const releaseSha = "a".repeat(40);

  it("is stable for retries within one workflow attempt", () => {
    const input = {
      releaseSha,
      workflowRunId: "12345678901",
      workflowRunAttempt: "2",
    };

    expect(buildWorkerCanaryOperationIds(input)).toEqual(
      buildWorkerCanaryOperationIds(input),
    );
    expect(buildWorkerCanaryOperationIds(input)).toEqual({
      batchId: "rel_aaaaaaaaaaaa_r12345678901_a2",
      transcriptionOperationId:
        "rel_aaaaaaaaaaaa_r12345678901_a2_transcribe",
      musicClipOperationId: "rel_aaaaaaaaaaaa_r12345678901_a2_music",
    });
  });

  it("stays within the strictest deployed operation-id contract", () => {
    const operationIds = buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "9".repeat(20),
      workflowRunAttempt: "9".repeat(10),
    });

    for (const value of Object.values(operationIds)) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(value.length).toBeLessThanOrEqual(64);
    }
  });

  it("does not replay receipts across workflow runs or rerun attempts", () => {
    const original = buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "12345678901",
      workflowRunAttempt: "1",
    });
    const rerun = buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "12345678901",
      workflowRunAttempt: "2",
    });
    const newRun = buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "12345678902",
      workflowRunAttempt: "1",
    });

    expect(rerun).not.toEqual(original);
    expect(newRun).not.toEqual(original);
  });

  it("rejects absent or malformed workflow execution identity", () => {
    expect(() => buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: undefined,
      workflowRunAttempt: "1",
    })).toThrow("MURMUR_RELEASE_SMOKE_RUN_ID");
    expect(() => buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "123",
      workflowRunAttempt: "0",
    })).toThrow("MURMUR_RELEASE_SMOKE_RUN_ATTEMPT");
  });

  it("reuses one operation identity for in-script HTTP retries", async () => {
    const operationIds = buildWorkerCanaryOperationIds({
      releaseSha,
      workflowRunId: "12345678901",
      workflowRunAttempt: "2",
    });
    const seenHeaders: Headers[] = [];
    const sleeps: number[] = [];

    const attempt = await fetchCanaryWithRetry(
      "/api/music/generate",
      {
        method: "POST",
        headers: {
          "x-generation-batch-id": operationIds.batchId,
          "x-generation-clip-id": operationIds.musicClipOperationId,
        },
      },
      1_000,
      {
        baseOrigin: "https://murmur.example",
        fetchImpl: async (_input, init) => {
          seenHeaders.push(new Headers(init?.headers));
          return new Response(null, {
            status: seenHeaders.length === 1 ? 503 : 200,
            headers: seenHeaders.length === 1
              ? undefined
              : { "X-Murmur-Operation-Replayed": "true" },
          });
        },
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    );

    expect(attempt.response.status).toBe(200);
    expect(attempt.retriedAfterAmbiguousFailure).toBe(true);
    expect(() => assertCanaryOperationEvidence(
      attempt,
      "music canary",
    )).not.toThrow();
    expect(seenHeaders).toHaveLength(2);
    expect(seenHeaders[0]?.get("x-generation-batch-id")).toBe(
      operationIds.batchId,
    );
    expect(seenHeaders[1]?.get("x-generation-batch-id")).toBe(
      operationIds.batchId,
    );
    expect(seenHeaders[0]?.get("x-generation-clip-id")).toBe(
      operationIds.musicClipOperationId,
    );
    expect(seenHeaders[1]?.get("x-generation-clip-id")).toBe(
      operationIds.musicClipOperationId,
    );
    expect(sleeps).toEqual([2_000]);
  });

  it("rejects a receipt replayed on the first successful request", () => {
    expect(() => assertCanaryOperationEvidence({
      response: new Response(null, {
        headers: { "X-Murmur-Operation-Replayed": "true" },
      }),
      retriedAfterAmbiguousFailure: false,
    }, "music canary")).toThrow("does not prove a new provider call");
  });

  it("accepts fresh delivery and a replay only after an ambiguous retry", () => {
    expect(() => assertCanaryOperationEvidence({
      response: new Response(null, {
        headers: { "X-Murmur-Operation-Replayed": "false" },
      }),
      retriedAfterAmbiguousFailure: false,
    }, "music canary")).not.toThrow();
    expect(() => assertCanaryOperationEvidence({
      response: new Response(null),
      retriedAfterAmbiguousFailure: false,
    }, "transcription canary")).not.toThrow();
    expect(() => assertCanaryOperationEvidence({
      response: new Response(null, {
        headers: { "X-Murmur-Operation-Replayed": "true" },
      }),
      retriedAfterAmbiguousFailure: true,
    }, "music canary")).not.toThrow();
  });

  it("accepts a replay after the first same-operation network attempt failed", async () => {
    let calls = 0;
    const attempt = await fetchCanaryWithRetry(
      "/api/transcribe",
      { headers: { "x-operation-id": "release_retry_transcribe" } },
      1_000,
      {
        baseOrigin: "https://murmur.example",
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) throw new TypeError("network reset");
          return new Response(null, {
            headers: { "X-Murmur-Operation-Replayed": "true" },
          });
        },
        sleep: async () => {},
      },
    );

    expect(attempt.retriedAfterAmbiguousFailure).toBe(true);
    expect(() => assertCanaryOperationEvidence(
      attempt,
      "transcription canary",
    )).not.toThrow();
  });

  it("rejects malformed replay evidence", () => {
    expect(() => assertCanaryOperationEvidence({
      response: new Response(null, {
        headers: { "X-Murmur-Operation-Replayed": "yes" },
      }),
      retriedAfterAmbiguousFailure: false,
    }, "music canary")).toThrow("invalid X-Murmur-Operation-Replayed");
  });
});
