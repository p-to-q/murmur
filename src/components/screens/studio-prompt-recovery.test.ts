import { describe, expect, it } from "bun:test";
import { studioPromptRecoveryForCode } from "./studio-prompt-recovery";

describe("studioPromptRecoveryForCode", () => {
  it("sends insufficient note errors to top-up instead of unknown prompt copy", () => {
    expect(studioPromptRecoveryForCode("insufficient_notes")).toEqual({
      messageKey: "studio.prompt.insufficient_notes",
      navigateTo: "/topup",
      refreshBalance: true,
    });
  });

  it("keeps billing errors in Studio with ledger-specific copy", () => {
    expect(studioPromptRecoveryForCode("billing_unavailable")).toEqual({
      messageKey: "studio.prompt.billing_unavailable",
      refreshBalance: true,
    });
  });

  it("keeps rate limits distinct from unknown prompt copy", () => {
    expect(studioPromptRecoveryForCode("rate_limited")).toEqual({
      messageKey: "studio.prompt.rate_limited",
    });
  });

  it("maps model and network outages to AI-unavailable copy", () => {
    expect(studioPromptRecoveryForCode("llm_unavailable").messageKey)
      .toBe("studio.prompt.llm_unavailable");
    expect(studioPromptRecoveryForCode("network_error").messageKey)
      .toBe("studio.prompt.llm_unavailable");
    expect(studioPromptRecoveryForCode("server_error").messageKey)
      .toBe("studio.prompt.llm_unavailable");
  });
});
