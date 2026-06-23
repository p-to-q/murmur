import { describe, expect, it } from "bun:test";
import {
  checkoutFailedPrimaryAction,
  checkoutFailedPrimaryLabelKey,
} from "./checkout-confirmation";

describe("checkout confirmation failure actions", () => {
  it("does not start a new payment when a success return is still confirming", () => {
    expect(checkoutFailedPrimaryAction("grant_pending")).toBe("confirm_grant");
    expect(checkoutFailedPrimaryLabelKey("grant_pending")).toBe("checkout.check_again");
  });

  it("keeps provider/request failures retryable", () => {
    expect(checkoutFailedPrimaryAction("generic")).toBe("retry_checkout");
    expect(checkoutFailedPrimaryLabelKey("generic")).toBe("checkout.try_again");
    expect(checkoutFailedPrimaryAction(null)).toBe("retry_checkout");
  });

  it("keeps sign-in failures on the sign-in action", () => {
    expect(checkoutFailedPrimaryAction("sign_in_required")).toBe("sign_in");
    expect(checkoutFailedPrimaryLabelKey("sign_in_required")).toBe("checkout.sign_in_btn");
  });
});
