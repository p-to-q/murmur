import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ResolvedSession } from "@/lib/db/queries/sessions";
import { resolveRequestAuth, type ResolveRequestAuthDeps } from "./server-auth";

// These tests exercise the cookie-session vs Google-session precedence inside
// resolveRequestAuth via its dependency-injection seam, so no DB or NextAuth
// request scope is required. Run them in production auth mode so the guest /
// local-header fallbacks are off and precedence is observed cleanly.
const originalAuthMode = process.env.MURMUR_AUTH_MODE;

beforeEach(() => {
  process.env.MURMUR_AUTH_MODE = "production";
});

afterEach(() => {
  if (originalAuthMode === undefined) delete process.env.MURMUR_AUTH_MODE;
  else process.env.MURMUR_AUTH_MODE = originalAuthMode;
});

function reqWithSession(token = "tok"): Request {
  return new Request("http://murmur.test/api", {
    headers: { cookie: `__murmur_session=${token}` },
  });
}

function localCreatorSession(id = "lc_1"): ResolvedSession {
  return {
    sessionId: "ses_lc",
    user: {
      id,
      email: null,
      name: "Local Creator",
      avatarUrl: null,
      accountKind: "local_creator",
    },
  };
}

function registeredSession(id = "usr_1"): ResolvedSession {
  return {
    sessionId: "ses_reg",
    user: {
      id,
      email: "reg@example.com",
      name: "Registered",
      avatarUrl: null,
      accountKind: "registered",
    },
  };
}

function googleSession(id = "g_1") {
  return { user: { id, email: "g@example.com", name: "Google User", image: null } };
}

interface FakeDepsConfig {
  session?: ResolvedSession | null;
  sessionError?: Error;
  nextAuth?: { user?: unknown } | null;
  nextAuthThrows?: boolean;
}

function deps(config: FakeDepsConfig): ResolveRequestAuthDeps {
  return {
    getSessionByToken: async () => {
      if (config.sessionError) throw config.sessionError;
      return config.session ?? null;
    },
    getNextAuthSession: async () => {
      if (config.nextAuthThrows) throw new Error("no request scope");
      return config.nextAuth ?? null;
    },
  };
}

describe("resolveRequestAuth precedence (Local Creator vs Google)", () => {
  it("lets a valid Google session win over a Local Creator cookie", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: localCreatorSession("lc_1"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.user.accountKind).toBe("registered");
      expect(auth.source).toBe("session");
      expect(auth.sessionId).toBeNull();
    }
  });

  it("keeps a registered/promoted cookie session winning even when Google is present", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: registeredSession("usr_1"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("usr_1");
      expect(auth.sessionId).toBe("ses_reg");
    }
  });

  it("stays a Local Creator when there is no Google session", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: localCreatorSession("lc_1"), nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("lc_1");
      expect(auth.user.accountKind).toBe("local_creator");
      expect(auth.sessionId).toBe("ses_lc");
    }
  });

  it("does not treat a guest NextAuth id as a real login over a Local Creator", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: localCreatorSession("lc_1"), nextAuth: { user: { id: "guest" } } }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.user.id).toBe("lc_1");
  });

  it("returns 503 when the session lookup fails, regardless of Google", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ sessionError: new Error("db down"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(503);
  });

  it("falls through an invalid cookie token to a valid Google session", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: null, nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.user.id).toBe("g_1");
  });

  it("rejects an invalid cookie token with no Google session in production", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: null, nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("resolves a Google session with no cookie present", async () => {
    const auth = await resolveRequestAuth(
      new Request("http://murmur.test/api"),
      {},
      deps({ nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.sessionId).toBeNull();
    }
  });
});
