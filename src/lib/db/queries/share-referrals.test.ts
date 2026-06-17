import { beforeEach, describe, expect, it, mock } from "bun:test";

type UserRow = { id: string; accountKind: string };

const selectRows: Array<UserRow | null> = [];
const grantCalls: Array<{
  userId: string;
  amount: number;
  reason: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}> = [];

let inviteeGrantResult = {
  ok: true as const,
  ledgerId: "nle_invitee",
  balanceBefore: 5,
  balanceAfter: 105,
  duplicate: true,
};
let referrerGrantResult = {
  ok: true as const,
  ledgerId: "nle_referrer",
  balanceBefore: 10,
  balanceAfter: 110,
  duplicate: false,
};

mock.module("@/lib/db/client", () => ({
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                for: async () => [selectRows.shift() ?? null],
              }),
            }),
          }),
        }),
      };
      return callback(tx);
    },
  },
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  grantNotesInTransaction: async (_tx: unknown, input: {
    userId: string;
    amount: number;
    reason: string;
    externalRef?: string;
    metadata?: Record<string, unknown>;
  }) => {
    grantCalls.push(input);
    return input.userId === "usr_invitee" ? inviteeGrantResult : referrerGrantResult;
  },
}));

const {
  canUseShareReferral,
  claimShareReferral,
  inviteeReferralExternalRef,
  normalizeReferralUserId,
  referralExternalRef,
} = await import("./share-referrals");

describe("share referral helpers", () => {
  beforeEach(() => {
    selectRows.length = 0;
    grantCalls.length = 0;
    selectRows.push(
      { id: "usr_invitee", accountKind: "registered" },
      { id: "usr_referrer", accountKind: "registered" },
    );
    inviteeGrantResult = {
      ok: true,
      ledgerId: "nle_invitee",
      balanceBefore: 5,
      balanceAfter: 105,
      duplicate: true,
    };
    referrerGrantResult = {
      ok: true,
      ledgerId: "nle_referrer",
      balanceBefore: 10,
      balanceAfter: 110,
      duplicate: false,
    };
  });

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
    const result = await claimShareReferral({
      referrerId: "usr_referrer",
      inviteeId: "usr_invitee",
    });

    expect(result).toEqual({
      ok: true,
      referrer: null,
      invitee: inviteeGrantResult,
      duplicate: true,
    });
    expect(grantCalls).toHaveLength(1);
    expect(grantCalls[0]).toMatchObject({
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
