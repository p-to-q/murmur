import { describe, expect, it } from "bun:test";
import { resolveEntitlement, userType, type EntitlementUser } from "./entitlements";

const freeUser: EntitlementUser = {
  id: "user_free",
  planTier: "free",
  isAuthenticated: true,
};

describe("userType", () => {
  it("treats null users as guests", () => {
    expect(userType(null)).toBe("guest");
  });

  it("treats authenticated premium users as premium", () => {
    expect(
      userType({
        id: "user_premium",
        planTier: "premium",
        isAuthenticated: true,
      }),
    ).toBe("premium");
  });
});

describe("resolveEntitlement", () => {
  it("gates save and top-up for guests", () => {
    expect(resolveEntitlement(null, 10)).toMatchObject({
      canHum: true,
      canSave: false,
      canTopUp: false,
      canDeleteAccount: false,
    });
  });

  it("allows authenticated users to save for free but gates paid actions by balance", () => {
    expect(resolveEntitlement(freeUser, 0)).toMatchObject({
      canHum: false,
      canSave: true,
      canLlmEdit: false,
      canExportWebm: false,
      canTopUp: true,
      canDeleteAccount: true,
      remainingNotes: 0,
    });
  });
});
