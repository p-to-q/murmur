import { GRANTS } from "@murmur/core";
import type { AppUser } from "@/lib/platform/types";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { eq } from "drizzle-orm";
import {
  grantNotesInTransaction,
  type GrantNotesResult,
} from "@/lib/db/queries/notes-ledger";

export const SHARE_REFERRAL_REWARD_NOTES = GRANTS.referral;

export function canUseShareReferral(user: Pick<AppUser, "id" | "accountKind"> | null | undefined): boolean {
  return Boolean(user && user.id !== "guest" && user.accountKind === "registered");
}

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

class ShareReferralGrantError extends Error {
  constructor(readonly reason: Extract<ClaimShareReferralResult, { ok: false }>["reason"]) {
    super(reason);
    this.name = "ShareReferralGrantError";
  }
}

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
  try {
    return await db.transaction(async (tx) => {
      const referrerRow = await tx
        .select({ id: users.id, accountKind: users.accountKind })
        .from(users)
        .where(eq(users.id, referrerId))
        .limit(1);
      const inviteeRow = await tx
        .select({ id: users.id, accountKind: users.accountKind })
        .from(users)
        .where(eq(users.id, inviteeId))
        .limit(1);

      if (referrerRow[0]?.accountKind !== "registered") {
        return { ok: false as const, reason: "invalid_referrer" as const };
      }
      if (inviteeRow[0]?.accountKind !== "registered") {
        return { ok: false as const, reason: "grant_failed" as const };
      }

      const referrer = await grantNotesInTransaction(tx, {
        userId: referrerId,
        amount: SHARE_REFERRAL_REWARD_NOTES,
        reason: "grant:referral",
        externalRef,
        metadata: {
          role: "referrer",
          inviteeId,
        },
      });
      if (!referrer.ok) {
        throw new ShareReferralGrantError("invalid_referrer");
      }

      const invitee = await grantNotesInTransaction(tx, {
        userId: inviteeId,
        amount: SHARE_REFERRAL_REWARD_NOTES,
        reason: "grant:referral",
        externalRef,
        metadata: {
          role: "invitee",
          referrerId,
        },
      });
      if (!invitee.ok) {
        throw new ShareReferralGrantError("grant_failed");
      }

      return {
        ok: true as const,
        referrer,
        invitee,
        duplicate: referrer.duplicate && invitee.duplicate,
      };
    });
  } catch (error) {
    if (error instanceof ShareReferralGrantError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

export function referralExternalRef(referrerId: string, inviteeId: string): string {
  return `referral:${referrerId}:${inviteeId}`;
}

export function normalizeReferralUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}
