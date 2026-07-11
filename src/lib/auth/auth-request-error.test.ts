import { describe, expect, it } from "bun:test";
import {
  AuthRequestError,
  buildAuthRequestError,
  toAuthRequestError,
} from "./auth-request-error";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("buildAuthRequestError", () => {
  it("maps a known server error code to the client code", async () => {
    const err = await buildAuthRequestError(
      jsonResponse({ error: "email_auth_disabled", requestId: "req_1" }, 404),
    );
    expect(err).toBeInstanceOf(AuthRequestError);
    expect(err.code).toBe("email_auth_disabled");
    expect(err.status).toBe(404);
    expect(err.requestId).toBe("req_1");
  });

  it("maps the verify codes emitted by verifyCode", async () => {
    const invalid = await buildAuthRequestError(
      jsonResponse({ error: "invalid_code" }, 400),
    );
    expect(invalid.code).toBe("invalid_code");

    const maxAttempts = await buildAuthRequestError(
      jsonResponse({ error: "max_attempts" }, 429),
    );
    expect(maxAttempts.code).toBe("max_attempts");
  });

  it("degrades an unknown server code to a status-based fallback", async () => {
    const err = await buildAuthRequestError(
      jsonResponse({ error: "teapot", requestId: "req_2" }, 418),
    );
    expect(err.code).toBe("server_error");
    expect(err.status).toBe(418);
    // requestId is still surfaced so the support code stays correlatable.
    expect(err.requestId).toBe("req_2");
  });

  it("recovers a rate-limit status even when the body is malformed", async () => {
    const err = await buildAuthRequestError(
      new Response("edge rate limiter html", { status: 429 }),
    );
    expect(err.code).toBe("rate_limit");
    expect(err.requestId).toBeNull();
  });

  it("falls back to server_error for a malformed 5xx body", async () => {
    const err = await buildAuthRequestError(
      new Response("bad gateway", { status: 502 }),
    );
    expect(err.code).toBe("server_error");
  });
});

describe("toAuthRequestError", () => {
  it("passes an existing AuthRequestError through unchanged", () => {
    const original = new AuthRequestError({
      code: "invalid_code",
      message: "x",
      status: 400,
    });
    expect(toAuthRequestError(original)).toBe(original);
  });

  it("wraps a rejected fetch as network_error", () => {
    const err = toAuthRequestError(new TypeError("Failed to fetch"));
    expect(err.code).toBe("network_error");
    expect(err.status).toBe(0);
    expect(err.message).toContain("Failed to fetch");
  });

  it("wraps a non-Error throw as network_error", () => {
    const err = toAuthRequestError("boom");
    expect(err.code).toBe("network_error");
    expect(err.status).toBe(0);
  });
});
