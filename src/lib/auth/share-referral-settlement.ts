import {
  claimShareReferralForRegistration,
  SHARE_REFERRAL_REWARD_NOTES,
  type ClaimShareReferralResult,
  type ShareReferralSource,
} from "@/lib/db/queries/share-referrals";
import {
  isReferralEligibleRegistrationKind,
  type UserRegistrationKind,
} from "@/lib/auth/registration-kind";
import { log } from "@/lib/observability/log";

export async function settleRegistrationShareReferral(input: {
  referrerId: string | null;
  inviteeId: string;
  registrationKind: UserRegistrationKind;
  source: ShareReferralSource;
  route: string;
  requestId?: string;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ClaimShareReferralResult | null> {
  if (!input.referrerId) return null;
  if (!isReferralEligibleRegistrationKind(input.registrationKind)) {
    return { ok: false, reason: "registration_required" };
  }

  let result: ClaimShareReferralResult;
  try {
    result = await claimShareReferralForRegistration({
      referrerId: input.referrerId,
      inviteeId: input.inviteeId,
      registrationKind: input.registrationKind,
      source: input.source,
      metadata: input.metadata,
    });
  } catch (error) {
    log("share.referral_failed", {
      reason: "exception",
      error: error instanceof Error ? error.name : "unknown",
      referrerId: input.referrerId,
      inviteeId: input.inviteeId,
      source: input.source,
      registrationKind: input.registrationKind,
    }, {
      route: input.route,
      requestId: input.requestId,
      userId: input.inviteeId,
      sessionId: input.sessionId,
      level: "warn",
    });
    return { ok: false, reason: "grant_failed" };
  }

  if (result.ok && !result.duplicate) {
    log("notes.granted", {
      reason: "grant:referral",
      amount: SHARE_REFERRAL_REWARD_NOTES,
      referrerId: input.referrerId,
      inviteeId: input.inviteeId,
      referralId: result.referralId,
      source: input.source,
      registrationKind: input.registrationKind,
    }, {
      route: input.route,
      requestId: input.requestId,
      userId: input.inviteeId,
      sessionId: input.sessionId,
    });
  }

  if (!result.ok && result.reason !== "registration_required") {
    log("share.referral_failed", {
      reason: result.reason,
      referrerId: input.referrerId,
      inviteeId: input.inviteeId,
      source: input.source,
      registrationKind: input.registrationKind,
    }, {
      route: input.route,
      requestId: input.requestId,
      userId: input.inviteeId,
      sessionId: input.sessionId,
      level: "warn",
    });
  }

  return result;
}
