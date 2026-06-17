import { GRANTS } from "@murmur/core";

import { grantNotes, type GrantNotesResult } from "@/lib/db/queries/notes-ledger";

export const SHARE_REFERRAL_REWARD_NOTES = GRANTS.referral;

export type ClaimShareReferralResult =
  | {
      ok: true;
      referrer: GrantNotesResult & { ok: true };
      invitee: GrantNotesResult & { ok: true };
      duplicate: boolean;
    }
  | {
      ok: false;
      reason: "self_referral" | "invalid_referrer" | "grant_failed";
    };

export async function claimShareReferral(input: {
  referrerId: string;
  inviteeId: string;
}): Promise<ClaimShareReferralResult> {
  const referrerId = normalizeReferralUserId(input.referrerId);
  const inviteeId = normalizeReferralUserId(input.inviteeId);

  if (!referrerId || referrerId === "guest") {
    return { ok: false, reason: "invalid_referrer" };
  }
  if (!inviteeId || inviteeId === "guest" || referrerId === inviteeId) {
    return { ok: false, reason: "self_referral" };
  }

  const externalRef = referralExternalRef(referrerId, inviteeId);
  const referrer = await grantNotes({
    userId: referrerId,
    amount: SHARE_REFERRAL_REWARD_NOTES,
    reason: "grant:referral",
    externalRef,
    metadata: {
      role: "referrer",
      inviteeId,
    },
  });
  if (!referrer.ok) return { ok: false, reason: "invalid_referrer" };

  const invitee = await grantNotes({
    userId: inviteeId,
    amount: SHARE_REFERRAL_REWARD_NOTES,
    reason: "grant:referral",
    externalRef,
    metadata: {
      role: "invitee",
      referrerId,
    },
  });
  if (!invitee.ok) return { ok: false, reason: "grant_failed" };

  return {
    ok: true,
    referrer,
    invitee,
    duplicate: referrer.duplicate && invitee.duplicate,
  };
}

export function referralExternalRef(referrerId: string, inviteeId: string): string {
  return `referral:${referrerId}:${inviteeId}`;
}

export function normalizeReferralUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}
