import { afterEach, describe, expect, it } from "bun:test";
import {
  getRequestUser,
  getSessionToken,
  isHeaderAuthAllowed,
  resolveRequestAuth,
} from "./server-auth";

const originalAllowHeaderAuth = process.env.MURMUR_ALLOW_HEADER_AUTH;
const originalAuthMode = process.env.MURMUR_AUTH_MODE;

afterEach(() => {
  if (originalAllowHeaderAuth === undefined) {
    delete process.env.MURMUR_ALLOW_HEADER_AUTH;
  } else {
    process.env.MURMUR_ALLOW_HEADER_AUTH = originalAllowHeaderAuth;
  }
  if (originalAuthMode === undefined) {
    delete process.env.MURMUR_AUTH_MODE;
  } else {
    process.env.MURMUR_AUTH_MODE = originalAuthMode;
  }
});

describe("server auth adapter", () => {
  it("ignores spoofable local-user headers when header auth is disabled", () => {
    process.env.MURMUR_AUTH_MODE = "local";
    process.env.MURMUR_ALLOW_HEADER_AUTH = "false";

    const user = getRequestUser(
      new Request("http://murmur.test", {
        headers: {
          "x-murmur-user-id": "attacker",
          "x-murmur-user-email": "spoof@example.com",
        },
      }),
    );

    expect(user.id).toBe("guest");
    expect(user.email).toBeNull();
  });

  it("defaults to production-like auth even outside production builds", async () => {
    delete process.env.MURMUR_AUTH_MODE;

    const auth = await resolveRequestAuth(new Request("http://localhost:3000"));

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("allows local-user headers only when explicitly enabled", () => {
    process.env.MURMUR_AUTH_MODE = "local";
    process.env.MURMUR_ALLOW_HEADER_AUTH = "true";

    const user = getRequestUser(
      new Request("http://murmur.test", {
        headers: {
          "x-murmur-user-id": "local_user",
          "x-murmur-user-name": "Local User",
        },
      }),
    );

    expect(user.id).toBe("local_user");
    expect(user.name).toBe("Local User");
  });

  it("never allows local-user headers in production auth mode", () => {
    process.env.MURMUR_AUTH_MODE = "production";
    process.env.MURMUR_ALLOW_HEADER_AUTH = "true";

    const user = getRequestUser(
      new Request("http://murmur.test", {
        headers: { "x-murmur-user-id": "attacker" },
      }),
    );

    expect(isHeaderAuthAllowed()).toBe(false);
    expect(user.id).toBe("guest");
  });

  it("rejects no-session production requests instead of falling back to guest", async () => {
    process.env.MURMUR_AUTH_MODE = "production";

    const auth = await resolveRequestAuth(new Request("http://murmur.test"));

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("allows explicit guest preview routes without enabling global fallback", async () => {
    process.env.MURMUR_AUTH_MODE = "production";

    const auth = await resolveRequestAuth(
      new Request("http://murmur.test/api/transcribe"),
      { allowGuestPreview: true },
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.source).toBe("guest");
      expect(auth.user.id).toBe("guest");
    }
  });

  it("keeps no-session local requests on the guest demo path", async () => {
    process.env.MURMUR_AUTH_MODE = "local";

    const auth = await resolveRequestAuth(new Request("http://localhost:3000"));

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.source).toBe("guest");
      expect(auth.user.id).toBe("guest");
    }
  });

  it("extracts bearer and cookie session tokens without trusting them yet", () => {
    expect(
      getSessionToken(
        new Request("http://murmur.test", {
          headers: { authorization: "Bearer tok_bearer" },
        }),
      ),
    ).toBe("tok_bearer");

    expect(
      getSessionToken(
        new Request("http://murmur.test", {
          headers: { cookie: "theme=dark; __murmur_session=tok_cookie" },
        }),
      ),
    ).toBe("tok_cookie");
  });
});
