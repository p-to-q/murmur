import { describe, expect, it } from "bun:test";
import { isAuthenticatedSession, shouldSkipNotesBilling } from "./session-billing";

describe("session billing classification", () => {
  it("keeps Local Creator out of account-only billing", () => {
    const auth = {
      ok: true as const,
      source: "session" as const,
      sessionId: "ses_local",
      user: {
        id: "lc_01HY",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator" as const,
      },
    };

    expect(isAuthenticatedSession(auth)).toBe(false);
    expect(shouldSkipNotesBilling(auth)).toBe(true);
  });

  it("treats registered sessions as server-billed accounts", () => {
    const auth = {
      ok: true as const,
      source: "session" as const,
      sessionId: "ses_user",
      user: {
        id: "usr_01HY",
        email: "a@example.com",
        name: "A",
        avatarUrl: null,
        accountKind: "registered" as const,
      },
    };

    expect(isAuthenticatedSession(auth)).toBe(true);
    expect(shouldSkipNotesBilling(auth)).toBe(false);
  });
});
