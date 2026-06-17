import { describe, expect, it } from "bun:test";
import { isAuthenticatedSession, shouldSkipNotesBilling } from "./session-billing";

describe("session billing classification", () => {
  it("keeps Local Creator out of account-only privileges but server-bills its row", () => {
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
    expect(shouldSkipNotesBilling(auth)).toBe(false);
  });

  it("skips ledger spends only for the shared guest preview identity", () => {
    const auth = {
      ok: true as const,
      source: "guest" as const,
      sessionId: null,
      user: {
        id: "guest",
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
