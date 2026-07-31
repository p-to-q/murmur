import { describe, expect, it } from "bun:test";

import {
  checkoutSuccessDestination,
  isTranscriptionResumeRequested,
  withTranscriptionResume,
} from "./transcription-recovery";

describe("transcription recovery navigation", () => {
  it("accepts only the bounded continuation value", () => {
    expect(isTranscriptionResumeRequested("transcription")).toBe(true);
    expect(isTranscriptionResumeRequested("https://evil.example")).toBe(false);
    expect(isTranscriptionResumeRequested("../admin")).toBe(false);
  });

  it("preserves existing checkout parameters without exposing operation data", () => {
    expect(withTranscriptionResume("/topup/checkout?sku=topup_30_notes"))
      .toBe("/topup/checkout?sku=topup_30_notes&resume=transcription");
  });

  it("returns successful recovery checkouts to Hum", () => {
    expect(checkoutSuccessDestination("transcription"))
      .toBe("/?resume=transcription");
    expect(checkoutSuccessDestination("unknown")).toBe("/me");
  });
});
