export const REFERRAL_ELIGIBLE_REGISTRATION_KINDS = [
  "new_user",
  "local_creator_promotion",
] as const;

export type ReferralEligibleRegistrationKind =
  (typeof REFERRAL_ELIGIBLE_REGISTRATION_KINDS)[number];

export type UserRegistrationKind =
  | ReferralEligibleRegistrationKind
  | "existing_identity"
  | "existing_user";

export function isReferralEligibleRegistrationKind(
  kind: UserRegistrationKind,
): kind is ReferralEligibleRegistrationKind {
  return (
    kind === "new_user"
    || kind === "local_creator_promotion"
  );
}
