export type CheckoutFailureKind =
  | "sign_in_required"
  | "grant_pending"
  | "generic";

export type CheckoutFailedPrimaryAction =
  | "sign_in"
  | "confirm_grant"
  | "retry_checkout";

export function checkoutFailedPrimaryAction(
  failureKind: CheckoutFailureKind | null,
): CheckoutFailedPrimaryAction {
  if (failureKind === "sign_in_required") return "sign_in";
  if (failureKind === "grant_pending") return "confirm_grant";
  return "retry_checkout";
}

export function checkoutFailedPrimaryLabelKey(
  failureKind: CheckoutFailureKind | null,
): string {
  if (failureKind === "sign_in_required") return "checkout.sign_in_btn";
  if (failureKind === "grant_pending") return "checkout.check_again";
  return "checkout.try_again";
}
