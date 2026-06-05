# Phase 3 Substrate — Session Resolver Boundary

Date: 2026-06-03

## User / System Problem

The notes ledger now gates expensive actions, but v1 still lets
`x-murmur-user-id` choose the request user. That is not safe enough for
payments. Full provider auth is still future work, but the platform adapter can
stop treating spoofable headers as production identity.

## Shipped

- Added `getSessionToken(request)` in `src/lib/platform/server-auth.ts`.
  It extracts bearer tokens and `__murmur_session` cookies without trusting
  them yet; DB-backed validation plugs into this seam next.
- Scoped v1 `x-murmur-user-*` headers to local/demo mode:
  - explicitly allowed by `MURMUR_ALLOW_HEADER_AUTH=true`; or
  - allowed by default outside `NODE_ENV=production`;
  - ignored in production unless explicitly enabled.
- Added tests proving spoofed local-user headers resolve to `guest` when header
  auth is disabled, while local demo mode can still opt in.
- Documented `MURMUR_ALLOW_HEADER_AUTH` in `.env.example`.
- Registered the `sessions` table with `user_id -> users.id`, token hash,
  expiry, revocation, and last-seen fields.
- Added session query helpers:
  - `createSession`
  - `getSessionByToken`
  - `revokeSessionByToken`
  - `hashSessionToken`
- Added `resolveRequestAuth(request)`: bearer/cookie token requests are
  validated against the sessions table; no-token requests fall back to
  guest/local-demo identity.
- Updated `/api/transcribe`, `/api/strummer/edit`, `/api/songs`, and
  `/api/user/balance` to use session-aware auth.
- Added `GET /api/auth/me`, a session-aware account snapshot that returns the
  resolved user, auth source, notes balance, next refill time, and computed
  entitlement. This gives future Web / native shells one hydration surface
  instead of making them stitch auth, billing, and entitlement state together.
- Added `POST /api/auth/logout` to revoke bearer/cookie sessions and clear the
  Web session cookie. Stale or absent tokens still clear the local cookie and
  return `{ ok: true }`.

## Carry-Forward

- Add `/api/auth/login/*` and refresh.
- Replace local `authClient` header emission with bearer/cookie session flow.
- Decide real identity providers for Web intl/cn, Capacitor, and WeChat MP.
