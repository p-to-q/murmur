import { describe, expect, it } from "bun:test";
import { classifyError, classifyHttpStatus, isTransient } from "./transient";

function errorWithStatus(status: number, extra?: Record<string, unknown>): Error {
  const error = new Error(`HTTP ${status}`);
  Object.assign(error, { status, ...extra });
  return error;
}

describe("classifyError", () => {
  it("classifies status-carrying errors by their status code", () => {
    expect(classifyError(errorWithStatus(401)).class).toBe("auth");
    expect(classifyError(errorWithStatus(403)).class).toBe("auth");
    expect(classifyError(errorWithStatus(402)).class).toBe("billing");
    expect(classifyError(errorWithStatus(400)).class).toBe("validation");
    expect(classifyError(errorWithStatus(413)).class).toBe("validation");
    expect(classifyError(errorWithStatus(422)).class).toBe("validation");
    expect(classifyError(errorWithStatus(404)).class).toBe("client");
    expect(classifyError(errorWithStatus(500)).class).toBe("internal");
  });

  it("marks 429/502/503/504 as retryable and other statuses as not", () => {
    for (const status of [429, 502, 503, 504]) {
      const classified = classifyError(errorWithStatus(status));
      expect(classified.class).toBe("transient");
      expect(classified.retryable).toBe(true);
    }
    for (const status of [400, 401, 402, 404, 500]) {
      expect(classifyError(errorWithStatus(status)).retryable).toBe(false);
    }
  });

  it("lets an explicit retryable flag override the status heuristic", () => {
    expect(classifyError(errorWithStatus(500, { retryable: true })).retryable).toBe(true);
    expect(classifyError(errorWithStatus(503, { retryable: false })).retryable).toBe(false);
  });

  it("treats TypeError and DOMException as transient network failures", () => {
    const typeError = classifyError(new TypeError("fetch failed"));
    expect(typeError.class).toBe("transient");
    expect(typeError.retryable).toBe(true);
    expect(typeError.status).toBe(502);

    const abort = classifyError(new DOMException("The operation was aborted", "AbortError"));
    expect(abort.class).toBe("transient");
    expect(abort.retryable).toBe(true);
  });

  it("sniffs transient network wording in plain Error messages", () => {
    for (const message of [
      "Connect timeout",
      "connect ECONNREFUSED 127.0.0.1:8002",
      "socket hang up: ECONNRESET",
      "fetch failed",
      "Network request failed",
    ]) {
      const classified = classifyError(new Error(message));
      expect(classified.class).toBe("transient");
      expect(classified.retryable).toBe(true);
    }
  });

  it("defaults plain errors and non-errors to non-retryable internal", () => {
    const plain = classifyError(new Error("something exploded"));
    expect(plain.class).toBe("internal");
    expect(plain.retryable).toBe(false);
    expect(plain.status).toBe(500);

    const stringy = classifyError("boom");
    expect(stringy.class).toBe("internal");
    expect(stringy.retryable).toBe(false);
    expect(stringy.message).toBe("boom");
  });
});

describe("classifyHttpStatus", () => {
  it("mirrors the status heuristics without an Error instance", () => {
    expect(classifyHttpStatus(429)).toEqual({
      class: "transient",
      retryable: true,
      message: "HTTP 429",
      status: 429,
    });
    expect(classifyHttpStatus(401).class).toBe("auth");
    expect(classifyHttpStatus(500).retryable).toBe(false);
  });
});

describe("isTransient", () => {
  it("matches classifyError's retryable verdict", () => {
    expect(isTransient(errorWithStatus(503))).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new Error("validation blew up"))).toBe(false);
    expect(isTransient(errorWithStatus(400))).toBe(false);
  });
});
