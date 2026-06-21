import { GRANTS } from "@murmur/core";
import type { AppUser } from "@/lib/platform/types";

import { db } from "@/lib/db/client";
import { shareReferrals } from "@/lib/db/schema/share-referrals";
import { users } from "@/lib/db/schema/users";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import {
  isReferralEligibleRegistrationKind,
  type UserRegistrationKind,
} from "@/lib/auth/registration-kind";
import {
  grantNotesInTransaction,
  type GrantNotesInput,
  type GrantNotesResult,
} from "@/lib/db/queries/notes-ledger";

export const SHARE_REFERRAL_REWARD_NOTES = GRANTS.referral;

export type ShareReferralSource = "oauth" | "email";

export function canUseShareReferral(user: Pick<AppUser, "id" | "accountKind"> | null | undefined): boolean {
  return Boolean(user && user.id !== "guest" && user.accountKind === "registered");
}

export type ClaimShareReferralResult =
  | {
      ok: true;
      referralId: string | null;
      referrer: (GrantNotesResult & { ok: true }) | null;
      invitee: (GrantNotesResult & { ok: true }) | null;
      duplicate: boolean;
    }
  | {
      ok: false;
      reason:
        | "self_referral"
        | "invalid_referrer"
        | "ineligible_invitee"
        | "registration_required"
        | "grant_failed";
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

type ExistingReferralRow = {
  id: string;
  referrerUserId: string;
  inviteeUserId: string;
  status: string;
} | null;

export async function claimShareReferralForRegistration(input: {
  referrerId: string | null | undefined;
  inviteeId: string;
  registrationKind: UserRegistrationKind;
  source: ShareReferralSource;
  metadata?: Record<string, unknown>;
}): Promise<ClaimShareReferralResult> {
  const referrerId = normalizeReferralUserId(input.referrerId);
  const inviteeId = normalizeReferralUserId(input.inviteeId);

  if (!isReferralEligibleRegistrationKind(input.registrationKind)) {
    return { ok: false, reason: "registration_required" };
  }
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
      const existingReferral = await findReferralByInvitee(tx, inviteeId);

      return claimShareReferralWithLockedUsers({
        referrerId,
        inviteeId,
        registrationKind: input.registrationKind,
        source: input.source,
        referrerExternalRef,
        inviteeExternalRef,
        referrerRow,
        inviteeRow,
        existingReferral,
        metadata: input.metadata,
        grantNotes: (grantInput) => grantNotesInTransaction(tx, grantInput),
        recordReferral: async (recordInput) => {
          const [row] = await tx
            .insert(shareReferrals)
            .values(recordInput)
            .onConflictDoNothing({
              target: shareReferrals.inviteeUserId,
            })
            .returning({ id: shareReferrals.id });
          return row?.id ?? null;
        },
      });
    });
  } catch (error) {
    if (error instanceof ShareReferralGrantError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

export async function getSettledShareReferralForInvitee(input: {
  referrerId: string | null | undefined;
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

  const [row] = await db
    .select({
      id: shareReferrals.id,
      referrerUserId: shareReferrals.referrerUserId,
      inviteeUserId: shareReferrals.inviteeUserId,
      status: shareReferrals.status,
    })
    .from(shareReferrals)
    .where(and(
      eq(shareReferrals.inviteeUserId, inviteeId),
      eq(shareReferrals.referrerUserId, referrerId),
    ))
    .limit(1);

  if (!row) return { ok: false, reason: "registration_required" };
  return referralAlreadySettled(row);
}

export async function claimShareReferralWithLockedUsers(input: {
  referrerId: string;
  inviteeId: string;
  registrationKind: UserRegistrationKind;
  source: ShareReferralSource;
  referrerExternalRef: string;
  inviteeExternalRef: string;
  referrerRow: ReferralUserRow;
  inviteeRow: ReferralUserRow;
  existingReferral: ExistingReferralRow;
  metadata?: Record<string, unknown>;
  grantNotes: (grantInput: GrantNotesInput) => Promise<GrantNotesResult>;
  recordReferral: (recordInput: {
    id: string;
    referrerUserId: string;
    inviteeUserId: string;
    status: "settled";
    source: ShareReferralSource;
    registrationKind: UserRegistrationKind;
    rewardNotes: number;
    referrerLedgerId: string;
    inviteeLedgerId: string;
    metadata: Record<string, unknown>;
    settledAt: Date;
  }) => Promise<string | null>;
}): Promise<ClaimShareReferralResult> {
  if (!isReferralEligibleRegistrationKind(input.registrationKind)) {
    return { ok: false as const, reason: "registration_required" as const };
  }
  if (input.existingReferral) return referralAlreadySettled(input.existingReferral);
  if (input.referrerRow?.accountKind !== "registered") {
    return { ok: false as const, reason: "invalid_referrer" as const };
  }
  if (input.inviteeRow?.accountKind !== "registered") {
    return { ok: false as const, reason: "ineligible_invitee" as const };
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
      referralId: null,
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

  const referralId = await input.recordReferral({
    id: createShareReferralId(),
    referrerUserId: input.referrerId,
    inviteeUserId: input.inviteeId,
    status: "settled",
    source: input.source,
    registrationKind: input.registrationKind,
    rewardNotes: SHARE_REFERRAL_REWARD_NOTES,
    referrerLedgerId: referrer.ledgerId,
    inviteeLedgerId: invitee.ledgerId,
    metadata: input.metadata ?? {},
    settledAt: new Date(),
  });
  if (!referralId) {
    throw new ShareReferralGrantError("grant_failed");
  }

  return {
    ok: true as const,
    referralId,
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

function referralAlreadySettled(row: ExistingReferralRow): ClaimShareReferralResult {
  if (!row) return { ok: false, reason: "registration_required" };
  return {
    ok: true,
    referralId: row.id,
    referrer: null,
    invitee: null,
    duplicate: true,
  };
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

async function findReferralByInvitee(
  tx: DbTransaction,
  inviteeId: string,
): Promise<ExistingReferralRow> {
  const [row] = await tx
    .select({
      id: shareReferrals.id,
      referrerUserId: shareReferrals.referrerUserId,
      inviteeUserId: shareReferrals.inviteeUserId,
      status: shareReferrals.status,
    })
    .from(shareReferrals)
    .where(eq(shareReferrals.inviteeUserId, inviteeId))
    .limit(1);
  return row ?? null;
}

function createShareReferralId(): string {
  return `srf_${ulid()}`;
}
