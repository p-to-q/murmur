import { afterEach, describe, expect, it } from "bun:test";
import { getRequestUser, getSessionToken } from "./server-auth";

const originalAllowHeaderAuth = process.env.MURMUR_ALLOW_HEADER_AUTH;

afterEach(() => {
  if (originalAllowHeaderAuth === undefined) {
    delete process.env.MURMUR_ALLOW_HEADER_AUTH;
  } else {
    process.env.MURMUR_ALLOW_HEADER_AUTH = originalAllowHeaderAuth;
  }
});

describe("server auth adapter", () => {
  it("ignores spoofable local-user headers when header auth is disabled", () => {
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

  it("allows local-user headers only when explicitly enabled", () => {
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
