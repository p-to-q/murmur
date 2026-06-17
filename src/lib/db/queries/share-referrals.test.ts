import { describe, expect, it } from "bun:test";
import {
  canUseShareReferral,
  normalizeReferralUserId,
  referralExternalRef,
} from "./share-referrals";

describe("share referral helpers", () => {
  it("allows referral rewards only for registered accounts", () => {
    expect(canUseShareReferral({
      id: "usr_registered",
      accountKind: "registered",
    })).toBe(true);

    expect(canUseShareReferral({
      id: "lc_creator",
      accountKind: "local_creator",
    })).toBe(false);
    expect(canUseShareReferral({ id: "guest", accountKind: "local_creator" })).toBe(false);
    expect(canUseShareReferral({ id: "usr_missing_kind", accountKind: null })).toBe(false);
    expect(canUseShareReferral(null)).toBe(false);
  });

  it("normalizes only bounded safe referral ids", () => {
    expect(normalizeReferralUserId(" usr_ABC-123 ")).toBe("usr_ABC-123");
    expect(normalizeReferralUserId("abc")).toBeNull();
    expect(normalizeReferralUserId("not an id")).toBeNull();
    expect(normalizeReferralUserId("x".repeat(129))).toBeNull();
  });

  it("uses a deterministic pair reference for idempotent dual grants", () => {
    expect(referralExternalRef("usr_referrer", "usr_invitee"))
      .toBe("referral:usr_referrer:usr_invitee");
  });
});
