import { afterEach, describe, expect, it } from "bun:test";
import { getJobStatus, RunpodError, runJob, submitJob } from "./runpod-serverless";

const realFetch = global.fetch;

describe("runJob RunPod submission", () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("attaches an execution policy (ttl + executionTimeout) so orphaned queue jobs self-reap", async () => {
    let runBody:
      | { input?: unknown; policy?: { ttl?: number; executionTimeout?: number } }
      | null = null;

    global.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/run")) {
        runBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({
            id: "job-1",
            status: "COMPLETED",
            output: { audio_b64: "AA==" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const output = await runJob(
      { endpointId: "ep-test", apiKey: "key-test" },
      { prompt: "hello" },
      { budgetMs: 5_000 },
    );

    expect(output).toEqual({ audio_b64: "AA==" });
    expect(runBody).not.toBeNull();
    expect(runBody!.input).toEqual({ prompt: "hello" });
    expect(runBody!.policy).toBeDefined();
    expect(typeof runBody!.policy!.ttl).toBe("number");
    expect(typeof runBody!.policy!.executionTimeout).toBe("number");
    // TTL must clear the scale-to-zero cold start (~4-5 min) and the caller's
    // own ~295s wait budget, or RunPod reaps a job someone is still waiting for.
    expect(runBody!.policy!.ttl).toBeGreaterThanOrEqual(360_000);
    // ...and stay well under RunPod's 24h default so the queue actually drains.
    expect(runBody!.policy!.ttl).toBeLessThan(86_400_000);
  });
});

describe("submitJob ambiguity", () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("classifies a lost submit response as submission_unknown", async () => {
    let submissions = 0;
    global.fetch = (async () => {
      submissions += 1;
      throw new DOMException("deadline", "TimeoutError");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await submitJob(
        { endpointId: "ep-test", apiKey: "key-test" },
        { prompt: "hello", request_id: "mjob_stable" },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RunpodError);
    expect((caught as RunpodError).kind).toBe("submission_unknown");
    expect(submissions).toBe(1);
  });
});

describe("getJobStatus", () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("classifies a missing provider job without retaining the response body", async () => {
    global.fetch = (async () => new Response(
      JSON.stringify({ error: "provider secret must not reach logs" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await getJobStatus(
        { endpointId: "ep-test", apiKey: "key-test" },
        "job-missing",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RunpodError);
    expect((caught as RunpodError).kind).toBe("not_found");
    expect((caught as RunpodError).detail).toBeUndefined();
  });

  it("classifies status transport failures without retaining fetch details", async () => {
    global.fetch = (async () => {
      throw new Error("socket contains provider detail");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await getJobStatus(
        { endpointId: "ep-test", apiKey: "key-test" },
        "job-transient",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RunpodError);
    expect((caught as RunpodError).kind).toBe("http");
    expect((caught as RunpodError).detail).toBeUndefined();
  });
});
