import { describe, expect, it } from "bun:test";
import {
  ApiEnvelopeError,
  apiErrorEnvelopeFrom,
  readApiErrorEnvelope,
} from "./error-envelope";

describe("readApiErrorEnvelope", () => {
  it("reads the standard error envelope", async () => {
    const response = new Response(
      JSON.stringify({
        error: "save_unavailable",
        message: "Database unavailable",
        requestId: "req_123",
      }),
      { status: 503 },
    );

    expect(await readApiErrorEnvelope(response, "save_failed")).toEqual({
      status: 503,
      code: "save_unavailable",
      requestId: "req_123",
    });
  });

  it("falls back when the body is not JSON", async () => {
    const response = new Response("upstream html error page", { status: 502 });

    expect(await readApiErrorEnvelope(response, "save_failed")).toEqual({
      status: 502,
      code: "save_failed",
      requestId: null,
    });
  });

  it("falls back when envelope fields are missing or malformed", async () => {
    const response = new Response(
      JSON.stringify({ error: 500, requestId: { nested: true } }),
      { status: 500 },
    );

    expect(await readApiErrorEnvelope(response, "delete_failed")).toEqual({
      status: 500,
      code: "delete_failed",
      requestId: null,
    });
  });
});

describe("apiErrorEnvelopeFrom", () => {
  it("unwraps ApiEnvelopeError and ignores other errors", () => {
    const envelope = { status: 404, code: "not_found", requestId: "req_9" };
    expect(apiErrorEnvelopeFrom(new ApiEnvelopeError(envelope))).toEqual(envelope);
    expect(apiErrorEnvelopeFrom(new Error("boom"))).toBeNull();
    expect(apiErrorEnvelopeFrom(undefined)).toBeNull();
  });
});

describe("readApiErrorEnvelope strict validation (#223)", () => {
  const knownCodes = new Set(["invalid_code", "rate_limit"]);

  it("passes a known code through unchanged and keeps the requestId", async () => {
    const response = new Response(
      JSON.stringify({ error: "invalid_code", requestId: "req_ok" }),
      { status: 400 },
    );
    expect(
      await readApiErrorEnvelope(response, "server_error", { knownCodes }),
    ).toEqual({ status: 400, code: "invalid_code", requestId: "req_ok" });
  });

  it("degrades an unknown code to the fallback but preserves the requestId", async () => {
    const response = new Response(
      JSON.stringify({ error: "teapot", requestId: "req_x" }),
      { status: 418 },
    );
    expect(
      await readApiErrorEnvelope(response, "server_error", { knownCodes }),
    ).toEqual({ status: 418, code: "server_error", requestId: "req_x" });
  });

  it("degrades a malformed (non-JSON) body to the fallback", async () => {
    const response = new Response("upstream html error page", { status: 502 });
    expect(
      await readApiErrorEnvelope(response, "server_error", { knownCodes }),
    ).toEqual({ status: 502, code: "server_error", requestId: null });
  });

  it("degrades when message is present but not a string, even with a known code", async () => {
    const response = new Response(
      JSON.stringify({ error: "rate_limit", message: 42 }),
      { status: 429 },
    );
    expect(
      await readApiErrorEnvelope(response, "server_error", { knownCodes }),
    ).toEqual({ status: 429, code: "server_error", requestId: null });
  });

  it("does not enforce membership when knownCodes is omitted (backward compatible)", async () => {
    const response = new Response(JSON.stringify({ error: "teapot" }), {
      status: 418,
    });
    expect(await readApiErrorEnvelope(response, "server_error")).toEqual({
      status: 418,
      code: "teapot",
      requestId: null,
    });
  });
});
