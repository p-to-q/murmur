import { describe, expect, it, mock } from "bun:test";

import { revokeLogoutSession } from "./session-exit";

describe("logout session exit", () => {
  it("uses the atomic session and push revocation result", async () => {
    const revoke = mock(async () => ({
      revoked: true,
      disabledPushSubscriptions: 2,
    }));

    await expect(revokeLogoutSession("tok_logout", revoke)).resolves.toEqual({
      revoked: true,
      disabledPushSubscriptions: 2,
    });
    expect(revoke).toHaveBeenCalledWith("tok_logout");
  });

  it("skips database work when the request has no session token", async () => {
    const revoke = mock(async () => ({
      revoked: true,
      disabledPushSubscriptions: 1,
    }));

    await expect(revokeLogoutSession(null, revoke)).resolves.toEqual({
      revoked: false,
      disabledPushSubscriptions: 0,
    });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("propagates transaction failures so the route can fail closed", async () => {
    const revoke = mock(async () => {
      throw new Error("database unavailable");
    });

    await expect(revokeLogoutSession("tok_logout", revoke)).rejects.toThrow(
      "database unavailable",
    );
  });
});
