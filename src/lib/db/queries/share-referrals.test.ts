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

  it("fails when the invitee ledger is duplicate without a referral record", async () => {
    const inviteeGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_invitee",
      balanceBefore: 5,
      balanceAfter: 5,
      duplicate: true,
    };
    const grantNotes = mock(async () => inviteeGrant);

    await expect(claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "new_user",
      source: "email",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      existingReferral: null,
      grantNotes,
      recordReferral: mock(async () => "srf_unused"),
    })).rejects.toThrow("grant_failed");

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

  it("records the settled referral after both ledger grants succeed", async () => {
    const inviteeGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_invitee",
      balanceBefore: 15,
      balanceAfter: 115,
      duplicate: false,
    };
    const referrerGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_referrer",
      balanceBefore: 10,
      balanceAfter: 110,
      duplicate: false,
    };
    const grants = [inviteeGrant, referrerGrant];
    const grantNotes = mock(async () => grants.shift()!);
    const recordReferral = mock(async () => "srf_recorded");

    const result = await claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "local_creator_promotion",
      source: "oauth",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      existingReferral: null,
      grantNotes,
      recordReferral,
    });

    expect(result).toEqual({
      ok: true,
      referralId: "srf_recorded",
      referrer: referrerGrant,
      invitee: inviteeGrant,
      duplicate: false,
    });
    expect(recordReferral).toHaveBeenCalledTimes(1);
    expect(recordReferral).toHaveBeenCalledWith(expect.objectContaining({
      referrerUserId: "usr_referrer",
      inviteeUserId: "usr_invitee",
      source: "oauth",
      registrationKind: "local_creator_promotion",
      rewardNotes: 100,
      referrerLedgerId: "nle_referrer",
      inviteeLedgerId: "nle_invitee",
    }));
  });

  it("fails the transaction when the referral record cannot be written", async () => {
    const inviteeGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_invitee",
      balanceBefore: 15,
      balanceAfter: 115,
      duplicate: false,
    };
    const referrerGrant: GrantNotesResult & { ok: true } = {
      ok: true,
      ledgerId: "nle_referrer",
      balanceBefore: 10,
      balanceAfter: 110,
      duplicate: false,
    };
    const grants = [inviteeGrant, referrerGrant];

    await expect(claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "new_user",
      source: "email",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      existingReferral: null,
      grantNotes: mock(async () => grants.shift()!),
      recordReferral: mock(async () => null),
    })).rejects.toThrow("grant_failed");
  });

  it("does not settle referrals for existing registered users", async () => {
    const grantNotes = mock(async () => ({
      ok: false as const,
      reason: "user_not_found" as const,
    }));

    const result = await claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "existing_user",
      source: "email",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      existingReferral: null,
      grantNotes,
      recordReferral: mock(async () => "srf_unused"),
    });

    expect(result).toEqual({
      ok: false,
      reason: "registration_required",
    });
    expect(grantNotes).toHaveBeenCalledTimes(0);
  });

  it("reports already-settled invitees without writing new grants", async () => {
    const grantNotes = mock(async () => ({
      ok: false as const,
      reason: "user_not_found" as const,
    }));

    const result = await claimShareReferralWithLockedUsers({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
      registrationKind: "new_user",
      source: "email",
      referrerExternalRef: referralExternalRef("usr_referrer", "usr_invitee"),
      inviteeExternalRef: inviteeReferralExternalRef("usr_invitee"),
      referrerRow: referralUser("usr_referrer"),
      inviteeRow: referralUser("usr_invitee"),
      existingReferral: {
        id: "srf_existing",
        referrerUserId: "usr_referrer",
        inviteeUserId: "usr_invitee",
        status: "settled",
      },
      grantNotes,
      recordReferral: mock(async () => "srf_unused"),
    });

    expect(result).toEqual({
      ok: true,
      referralId: "srf_existing",
      referrer: null,
      invitee: null,
      duplicate: true,
    });
    expect(grantNotes).toHaveBeenCalledTimes(0);
  });

});

function referralUser(id: string) {
  return {
    id,
    accountKind: "registered",
  };
}
