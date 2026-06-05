import { describe, expect, it } from "bun:test";
import { formatHumSupportCode, formatSupportCode } from "./support-code";

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
});
