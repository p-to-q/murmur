import { describe, expect, it } from "bun:test";
import { humErrorLogLevel } from "./hum-error-log-level";

describe("humErrorLogLevel", () => {
  it("keeps handled transient failures at warn level", () => {
    expect(humErrorLogLevel("worker_unavailable")).toBe("warn");
    expect(humErrorLogLevel("network_error")).toBe("warn");
    expect(humErrorLogLevel("billing_unavailable")).toBe("warn");
  });

  it("keeps user-correctable audio issues at warn level", () => {
    expect(humErrorLogLevel("no_voiced_frames")).toBe("warn");
    expect(humErrorLogLevel("audio_too_large")).toBe("warn");
    expect(humErrorLogLevel("insufficient_notes")).toBe("warn");
  });

  it("preserves true server failures as errors", () => {
    expect(humErrorLogLevel("server_error")).toBe("error");
  });
});
