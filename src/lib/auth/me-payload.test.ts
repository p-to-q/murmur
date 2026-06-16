import { describe, expect, it } from "bun:test";
import { buildAuthMePayload } from "./me-payload";

describe("auth me payload", () => {
  it("treats guest identity as a non-authenticated entitlement subject", () => {
    const payload = buildAuthMePayload({
      user: { id: "guest", name: "Local Creator", email: null, avatarUrl: null },
      source: "guest",
      sessionId: null,
      balance: { notes: 50, planTier: "free" },
      now: new Date("2026-06-03T15:30:00.000Z"),
    });

    expect(payload.authenticated).toBe(false);
    expect(payload.entitlement.canHum).toBe(true);
    expect(payload.entitlement.canSave).toBe(false);
    expect(payload.balance.nextRefillAt).toBe("2026-06-03T16:00:00.000Z");
  });

  it("keeps local demo identities aligned with currently allowed demo writes", () => {
    const payload = buildAuthMePayload({
      user: { id: "usr_demo", name: "Demo Creator", email: null, avatarUrl: null },
      source: "local_header",
      sessionId: null,
      balance: { notes: 50, planTier: "free" },
    });

    expect(payload.authenticated).toBe(true);
    expect(payload.entitlement.canSave).toBe(true);
    expect(payload.entitlement.canTopUp).toBe(true);
  });

  it("treats Local Creator sessions as owned but not registered accounts", () => {
    const payload = buildAuthMePayload({
      user: {
        id: "lc_01HY",
        name: "Local Creator",
        email: null,
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "ses_local",
      balance: { notes: 5, planTier: "free" },
      now: new Date("2026-06-03T15:30:00.000Z"),
    });

    expect(payload.authenticated).toBe(false);
    expect(payload.entitlement.canHum).toBe(true);
    expect(payload.entitlement.canSave).toBe(true);
    expect(payload.entitlement.canTopUp).toBe(false);
    expect(payload.entitlement.canDeleteAccount).toBe(false);
  });
});
