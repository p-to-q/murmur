import { GRANTS } from "@murmur/core";
import type { AppUser } from "@/lib/platform/types";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { eq } from "drizzle-orm";
import {
  grantNotesInTransaction,
  type GrantNotesInput,
  type GrantNotesResult,
} from "@/lib/db/queries/notes-ledger";

export const SHARE_REFERRAL_REWARD_NOTES = GRANTS.referral;

export function canUseShareReferral(user: Pick<AppUser, "id" | "accountKind"> | null | undefined): boolean {
  return Boolean(user && user.id !== "guest" && user.accountKind === "registered");
}

export type ClaimShareReferralResult =
  | {
      ok: true;
      referrer: (GrantNotesResult & { ok: true }) | null;
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

type ReferralUserRow = {
  id: string;
  accountKind: string;
} | null;

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

  const referrerExternalRef = referralExternalRef(referrerId, inviteeId);
  const inviteeExternalRef = inviteeReferralExternalRef(inviteeId);
  try {
    return await db.transaction(async (tx) => {
      const { referrerRow, inviteeRow } = await lockReferralUsers(tx, referrerId, inviteeId);

      return claimShareReferralWithLockedUsers({
        referrerId,
        inviteeId,
        referrerExternalRef,
        inviteeExternalRef,
        referrerRow,
        inviteeRow,
        grantNotes: (grantInput) => grantNotesInTransaction(tx, grantInput),
      });
    });
  } catch (error) {
    if (error instanceof ShareReferralGrantError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

export async function claimShareReferralWithLockedUsers(input: {
  referrerId: string;
  inviteeId: string;
  referrerExternalRef: string;
  inviteeExternalRef: string;
  referrerRow: ReferralUserRow;
  inviteeRow: ReferralUserRow;
  grantNotes: (grantInput: GrantNotesInput) => Promise<GrantNotesResult>;
}): Promise<ClaimShareReferralResult> {
  if (input.referrerRow?.accountKind !== "registered") {
    return { ok: false as const, reason: "invalid_referrer" as const };
  }
  if (input.inviteeRow?.accountKind !== "registered") {
    return { ok: false as const, reason: "grant_failed" as const };
  }

  const invitee = await input.grantNotes({
    userId: input.inviteeId,
    amount: SHARE_REFERRAL_REWARD_NOTES,
    reason: "grant:referral",
    externalRef: input.inviteeExternalRef,
    metadata: {
      role: "invitee",
      referrerId: input.referrerId,
    },
  });
  if (!invitee.ok) {
    throw new ShareReferralGrantError("grant_failed");
  }
  if (invitee.duplicate) {
    return {
      ok: true as const,
      referrer: null,
      invitee,
      duplicate: true,
    };
  }

  const referrer = await input.grantNotes({
    userId: input.referrerId,
    amount: SHARE_REFERRAL_REWARD_NOTES,
    reason: "grant:referral",
    externalRef: input.referrerExternalRef,
    metadata: {
      role: "referrer",
      inviteeId: input.inviteeId,
    },
  });
  if (!referrer.ok) {
    throw new ShareReferralGrantError("invalid_referrer");
  }

  return {
    ok: true as const,
    referrer,
    invitee,
    duplicate: referrer.duplicate || invitee.duplicate,
  };
}

export function referralExternalRef(referrerId: string, inviteeId: string): string {
  return `referral:referrer:${referrerId}:invitee:${inviteeId}`;
}

export function inviteeReferralExternalRef(inviteeId: string): string {
  return `referral:invitee:${inviteeId}`;
}

export function normalizeReferralUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_-]{6,128}$/.test(trimmed) ? trimmed : null;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockReferralUsers(
  tx: DbTransaction,
  referrerId: string,
  inviteeId: string,
): Promise<{
  referrerRow: ReferralUserRow;
  inviteeRow: ReferralUserRow;
}> {
  const rows = new Map<string, NonNullable<ReferralUserRow>>();
  const orderedIds = [referrerId, inviteeId].sort();

  for (const userId of orderedIds) {
    const [row] = await tx
      .select({ id: users.id, accountKind: users.accountKind })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (row) rows.set(row.id, row);
  }

  return {
    referrerRow: rows.get(referrerId) ?? null,
    inviteeRow: rows.get(inviteeId) ?? null,
  };
}
