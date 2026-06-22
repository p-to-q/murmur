import { describe, expect, it } from "bun:test";

import {
  hasCookieAuthenticatedSession,
  validateCookieAuthenticatedSameOrigin,
} from "./origin-guard";

function request(method: string, headers: HeadersInit = {}): Request {
  return new Request("https://murmur.example/api/songs", {
    method,
    headers,
  });
}

describe("validateCookieAuthenticatedSameOrigin", () => {
  it("allows unsafe webhook-style requests when no session cookie is present", () => {
    expect(validateCookieAuthenticatedSameOrigin(request("POST")).allowed).toBe(true);
  });

  it("allows safe requests even when a session cookie is present", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("GET", {
        cookie: "__murmur_session=tok_test",
        origin: "https://evil.example",
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it("allows cookie-authenticated unsafe requests from the same origin", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("POST", {
        cookie: "__murmur_session=tok_test",
        origin: "https://murmur.example",
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it("falls back to same-origin referer when origin is absent", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("DELETE", {
        cookie: "__Secure-authjs.session-token.0=tok_test",
        referer: "https://murmur.example/song/song_test",
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it("does not trust referer when origin is present but invalid", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("DELETE", {
        cookie: "__Secure-authjs.session-token.0=tok_test",
        origin: "%%%not-a-url",
        referer: "https://murmur.example/song/song_test",
      }),
    );

    expect(result).toEqual({
      allowed: false,
      reason: "missing_origin",
      requestOrigin: null,
      targetOrigin: "https://murmur.example",
    });
  });

  it("rejects cookie-authenticated unsafe requests from another origin", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("POST", {
        cookie: "__murmur_session=tok_test",
        origin: "https://evil.example",
      }),
    );

    expect(result).toEqual({
      allowed: false,
      reason: "cross_origin",
      requestOrigin: "https://evil.example",
      targetOrigin: "https://murmur.example",
    });
  });

  it("rejects cookie-authenticated unsafe requests without origin evidence", () => {
    const result = validateCookieAuthenticatedSameOrigin(
      request("PATCH", {
        cookie: "theme=dark; authjs.session-token=tok_test",
      }),
    );

    expect(result).toEqual({
      allowed: false,
      reason: "missing_origin",
      requestOrigin: null,
      targetOrigin: "https://murmur.example",
    });
  });
});

describe("hasCookieAuthenticatedSession", () => {
  it("recognizes Murmur and Auth.js session cookies", () => {
    expect(hasCookieAuthenticatedSession(new Headers({ cookie: "__murmur_session=tok" }))).toBe(true);
    expect(
      hasCookieAuthenticatedSession(
        new Headers({ cookie: "__Secure-authjs.session-token.1=tok" }),
      ),
    ).toBe(true);
  });

  it("ignores non-session cookies", () => {
    expect(
      hasCookieAuthenticatedSession(
        new Headers({ cookie: "authjs.csrf-token=csrf; theme=dark" }),
      ),
    ).toBe(false);
  });
});
