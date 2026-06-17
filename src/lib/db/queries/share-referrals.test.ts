import { describe, expect, it, mock } from "bun:test";
import type { GrantNotesResult } from "./notes-ledger";
import {
  canUseShareReferral,
  claimShareReferralWithLockedUsers,
  inviteeReferralExternalRef,
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

  it("uses deterministic references for idempotent referral grants", () => {
    expect(referralExternalRef("usr_referrer", "usr_invitee"))
      .toBe("referral:referrer:usr_referrer:invitee:usr_invitee");
    expect(inviteeReferralExternalRef("usr_invitee"))
      .toBe("referral:invitee:usr_invitee");
  });

  it("short-circuits duplicate invitees before crediting the referrer again", async () => {
    const inviteeGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_invitee",
      balanceBefore: 5,
      balanceAfter: 5,
      duplicate: true,
    };
    const grantNotes = mock(async () => inviteeGrant);

    const result = await claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      grantNotes,
    });

    expect(result).toEqual({
      ok: true,
      referrer: null,
      invitee: inviteeGrant,
      duplicate: true,
    });
    expect(grantNotes).toHaveBeenCalledTimes(1);
    expect(grantNotes).toHaveBeenCalledWith({
      userId: "usr_invitee",
      amount: 100,
      reason: "grant:referral",
      externalRef: "referral:invitee:usr_invitee",
      metadata: {
        role: "invitee",
        referrerId: "usr_referrer",
      },
    });
  });

});

function referralUser(id: string) {
  return {
    id,
    accountKind: "registered",
  };
}
