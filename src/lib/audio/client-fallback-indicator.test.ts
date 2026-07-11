import { describe, expect, it } from "bun:test";
import { shouldShowClientFallbackIndicator } from "./client-fallback-indicator";

describe("shouldShowClientFallbackIndicator", () => {
  it("shows once for a successful client pYIN result", () => {
    expect(
      shouldShowClientFallbackIndicator({
        provider: "client_pyin",
        alreadyShown: false,
      }),
    ).toBe(true);

    expect(
      shouldShowClientFallbackIndicator({
        provider: "client_pyin",
        alreadyShown: true,
      }),
    ).toBe(false);
  });

  it.each(["rmvpe", "swiftf0", "pyin", "yin", "parselmouth", "fixture"] as const)(
    "does not show for %s",
    (provider) => {
      expect(
        shouldShowClientFallbackIndicator({
          provider,
          alreadyShown: false,
        }),
      ).toBe(false);
    },
  );
});
