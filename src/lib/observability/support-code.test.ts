import { describe, expect, it } from "bun:test";
import {
  formatHumSupportCode,
  formatVibeSupportCode,
  formatStudioSupportCode,
  formatShareSupportCode,
  formatSupportCode,
} from "./support-code";

describe("formatSupportCode", () => {
  it("uses the formal AREA-ERROR-SHORTID shape", () => {
    expect(
      formatSupportCode({
        area: "hum",
        error: "worker_unavailable",
        requestId: "d3e8b5ba-00c1-41f3-a4eb-e8b22e5882d4",
      }),
    ).toBe("HUM-WORKER_UNAVAILABLE-Y72ZLB");
  });

  it("falls back to LOCAL when request id is absent", () => {
    expect(
      formatSupportCode({
        area: "hum",
        error: "mic_unavailable",
        requestId: null,
      }),
    ).toBe("HUM-MIC_UNAVAILABLE-LOCAL");
  });

  it("keeps a hum-specific wrapper for the current audio flow", () => {
    expect(
      formatHumSupportCode({
        code: "no_voiced_frames",
        requestId: "req_422",
      }),
    ).toBe("HUM-NO_VOICED_FRAMES-9UKWDG");
  });

  it("formats a vibe support code", () => {
    expect(
      formatVibeSupportCode({
        code: "worker_unconfigured",
        requestId: "req_500",
      }),
    ).toBe("VIBE-WORKER_UNCONFIGURED-2ZLBN5");
  });

  it("formats a vibe support code with null requestId", () => {
    expect(
      formatVibeSupportCode({
        code: "server_error",
        requestId: null,
      }),
    ).toBe("VIBE-SERVER_ERROR-LOCAL");
  });

  it("formats a studio support code", () => {
    expect(
      formatStudioSupportCode({
        code: "insufficient_notes",
        requestId: "req_789",
      }),
    ).toBe("STUDIO-INSUFFICIENT_NOTES-RC3EVY");
  });

  it("formats a share support code", () => {
    expect(
      formatShareSupportCode({
        code: "clipboard_unavailable",
        requestId: "req_101",
      }),
    ).toBe("SHARE-CLIPBOARD_UNAVAILABLE-T6MQXS");
  });
});
