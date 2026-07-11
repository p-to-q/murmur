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
