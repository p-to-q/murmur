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

  it("falls through to Google when the session lookup fails on normal authenticated routes (#313)", async () => {
    // A valid Auth.js session must authenticate even when the Murmur session
    // DB is down — the request should NOT collapse to 503 with an OAuth login
    // present. Mirrors the guest-preview fall-through.
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ sessionError: new Error("db down"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.user.accountKind).toBe("registered");
      expect(auth.source).toBe("session");
    }
  });

  it("falls through to Google when a guest-preview route cannot read the local cookie session", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      { allowGuestPreview: true },
      deps({ sessionError: new Error("db down"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.user.accountKind).toBe("registered");
    }
  });

  it("falls back to guest preview when a local cookie session lookup is unavailable and no Google session exists", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      { allowGuestPreview: true },
      deps({ sessionError: new Error("db down"), nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.source).toBe("guest");
      expect(auth.user.id).toBe("guest");
      expect(auth.sessionId).toBeNull();
    }
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

// Issue #313: precedence when Murmur session infrastructure is unavailable.
// The invariant: a valid Auth.js session authenticates before any 503 is
// returned; an invalid local token never becomes guest access; and when
// neither source is valid, 503 (infra down) vs 401 (unauthorized) stays
// honest. All four cases run on a NORMAL authenticated route (no
// allowGuestPreview) in production mode.
describe("resolveRequestAuth precedence on Murmur session outage (#313)", () => {
  it("DB failure + valid OAuth -> authenticates via Auth.js (not 503)", async () => {
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ sessionError: new Error("db down"), nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.user.accountKind).toBe("registered");
      expect(auth.source).toBe("session");
      expect(auth.sessionId).toBeNull();
    }
  });

  it("DB failure + invalid cookie (no rescuing OAuth) -> honest 503, not guest", async () => {
    // The Murmur session DB is down and no Auth.js session resolves. This is
    // an infrastructure outage, so the request must fail 503 — not silently
    // degrade to guest access and not masquerade as a 401 unauthorized.
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ sessionError: new Error("db down"), nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(503);
      const body = (await auth.response.json()) as { error: string };
      expect(body.error).toBe("session_unavailable");
    }
  });

  it("valid OAuth (session infra healthy) -> authenticates via Auth.js", async () => {
    const auth = await resolveRequestAuth(
      new Request("http://murmur.test/api"),
      {},
      deps({ nextAuth: googleSession("g_1") }),
    );

    expect(auth.ok).toBe(true);
    if (auth.ok) {
      expect(auth.user.id).toBe("g_1");
      expect(auth.user.accountKind).toBe("registered");
      expect(auth.source).toBe("session");
    }
  });

  it("no session at all -> honest 401 unauthorized, not guest", async () => {
    const auth = await resolveRequestAuth(
      new Request("http://murmur.test/api"),
      {},
      deps({ nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("invalid local token + no OAuth -> 401, never falls through to guest", async () => {
    // Guards the second requirement explicitly: a present-but-invalid cookie
    // (DB healthy, token resolves to no session) must not become guest access.
    const auth = await resolveRequestAuth(
      reqWithSession(),
      {},
      deps({ session: null, nextAuthThrows: true }),
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });
});
