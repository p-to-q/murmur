# Framework + Library Survey, 2026-06

Status: one-day external scan of the consumer-app framework / starter / OSS
landscape, focused on "what can Murmur reuse instead of inventing?" All
GitHub star counts, npm versions, and license claims were re-checked
between 2026-06-02 and 2026-06-03 against live pages; star numbers drift
daily, treat them as ±5%.

This doc is a sibling to:

- [docs/research-2026-06.md](./research-2026-06.md) — distribution / audio / China / IAP risk audit.
- [docs/cross-platform-strategy.md](./cross-platform-strategy.md) — chosen framework path per surface.
- [docs/engineering-principles.md](./engineering-principles.md) — "smallest correct change" stance.

It overrides neither. Where this doc and a phase plan disagree about
which library to adopt, the recommendation here is the *current* finding
and any phase plan that picked the older option should be patched in the
PR that adopts the new library.

## 0. Why this exists

The user's framing in the kickoff session:

> "GitHub 上有没有这种框架，如果有就不用自己造轮子了。包括我们已经写的
> 一些东西，也可以跟框架比对。"

Two product realities make this question worth half a day of careful
research instead of a five-minute "use next-forge" answer:

1. Murmur is **already mid-build.** A substantial substrate exists in
   `src/lib/` and `packages/murmur-core/`. The interesting question is
   not "what starter should we have used?" but "which upstream library
   is enough better than what we've shipped that we should swap, and
   which is just rebranded copies of what we already have?"
2. Murmur ships to **four surfaces** (web / iOS / Android / 微信 MP).
   Most consumer-app starters are single-surface; their architectural
   assumptions break the moment Capacitor + 微信 MP enter the picture.
   The selection bar is "does it survive *our* topology?", not "is it
   trending on Twitter?"

The output is recommendations, not endorsements. Each rec answers:
adopt / borrow / defer, with a one-paragraph justification grounded in
the current repo.

---

## Q1. Cross-cutting concerns beyond billing

Enumerated as a checklist so a downstream phase plan can adopt this as
the canonical "what Murmur needs to wire" list. Status column reflects
the repo on 2026-06-03 (WIP from the prior agent included).

| Concern | Why Murmur needs it | When | Status today |
|---|---|---|---|
| **Identity / signup** | Save → Gallery requires an account; Sign in with Apple is App Store mandatory if any other social login ships. | Phase 3 (auth substrate). | WIP — `src/lib/auth/`, `packages/murmur-core/src/auth/entitlements.ts`, `users` schema exist. No OAuth/Apple/passkey provider wired. |
| **Sessions / multi-device / logout** | Same user records melodies on web + iOS + 微信; sessions must be revocable for "log out of all devices" + 5.1.1(v). | Phase 3. | WIP — `sessions` schema + `sessions.ts` queries exist; no UI; logout route stubbed. |
| **Email verification + password reset** | If we add email/password (and we will, China can't easily do Apple/Google), both are required by basic security hygiene and to recover accounts. | Phase 3+. | Not started. |
| **Account deletion (in-app)** | **App Store 5.1.1(v) requires "delete account" inside the app** (not just email support). PIPL + GDPR also enforce a verifiable delete path. | Phase 3, blocking iOS submission. | Not started. No `/api/account/delete` route. |
| **Profile / preferences** | Language, default vibe, push opt-in, notification time-of-day. | Phase 3–4. | Stub in user schema; no UI. |
| **Notifications (push, email, in-app)** | APNs push is one of the App-Store-4.2 native features we must demonstrate (`research-2026-06.md` §1). Email for receipts + cron digest. | Phase 4–6. | Adapter shape stubbed in `src/lib/platform/`; not wired. |
| **Deep links / Universal Links / Custom Schemes** | Share a song → open in app, both iOS and 微信. | Phase 6. | Not started. |
| **Internationalization** | At minimum `zh-CN` + `en`. 微信 surface needs the same dict. | All phases. | `src/lib/i18n/dict.ts` exists (hand-rolled). No locale negotiation. |
| **Feature flags / A/B** | Onboarding seeded-demo, paywall placement, microphone-permission copy. | Phase 5+. | Not started. |
| **Observability (logs / metrics / errors)** | Already in `src/lib/observability/log.ts`. Needs a sink, not just stdout, before iOS. | Phase 4+. | Partial — typed event taxonomy + in-memory ring; no remote sink. |
| **Webhook receivers (RevenueCat, Stripe, WeChat Pay)** | Every payment provider in the matrix is webhook-driven. Need signature verification + idempotency + retry. | Phase 4. | Schema only (`events-webhook.ts`); no handler. |
| **Background jobs / queue** | Audio worker timeouts → retry; daily refill (`nextNotesRefillAt`); email cron. | Phase 4. | Not started; `notes-clock.ts` knows when, nothing schedules. |
| **Customer support / feedback / "rate this app"** | App Store 4.2 native feature; in-app review prompt at the right cohort moment. | Phase 6. | Not started. |
| **Onboarding** | Empty-gallery seeded demo + first-recording teach (`research-2026-06.md` §8). | Phase 1.5. | Not started. |
| **Referrals / invites** | Plausibly a v3 lever; not in v2. | v3+. | N/A. |
| **Image / media processing** | Song poster (Open Graph image, share card). | Phase 5. | Not started. |
| **Realtime / multi-device sync** | Optional v3; v2 assumes single-shell active session. | v3+. | N/A. |
| **Crash reporting** | iOS native crashes must be captured (Apple TestFlight gives stacks, but in-app shell needs them too). | Phase 6. | Not started. |
| **Admin / ops surface** | Refund a user's notes; freeze a session; impersonate for debug. We have ledger primitives, no admin UI. | Phase 4. | `decideRefund` exists; no admin route. |
| **Compliance (GDPR / PIPL / CCPA / ATT)** | iOS App Tracking Transparency prompt; PIPL data-export endpoint; cookie / region banner on web. | Phase 4–6. | Not started. |

> The five gating items for the **iOS submission** specifically (in
> order of "if missing, you don't ship"):
> 1. Sign in with Apple (auth-substrate Phase 3).
> 2. APNs push registration (notifications adapter Phase 4).
> 3. In-app account deletion endpoint + UI (Phase 3).
> 4. ATT prompt if any analytics SDK hits IDFA (Phase 6).
> 5. StoreKit IAP via RevenueCat (payment Phase 4).
>
> Everything else is "real product," but the App Store gate stops at
> these.

---

## Q2. Full-stack starter survey

For each repo: link, last verified star count, last push date, license,
stack, what it solves, and whether Murmur should fork / borrow / skip.

### next-forge — Vercel-aligned Turborepo template

- Repo: https://github.com/haydenbleasel/next-forge
- Stars: ~7.1k (2026-06-03). Apache-2.0. Active.
- Stack: Next.js + Turborepo + Prisma (DB), Clerk (auth), Stripe, Resend,
  Arcjet (security), BetterStack (logs). Opinionated to the point of
  "if you don't want Clerk + Stripe + Prisma, this is the wrong template."
- Fit with Murmur: **partial overlap, do not fork.** We use Drizzle (not
  Prisma), we'll likely use Better Auth (not Clerk), our payment is
  RevenueCat + Stripe + WeChat Pay (not Stripe-only). Forking next-forge
  forces three migrations we don't want.
- What's worth borrowing:
  - The monorepo layout (`apps/web`, `apps/api`, `packages/*`) closely
    matches what `cross-platform-strategy.md` §5 already projects — read
    it as a sanity check before we carve `apps/capacitor` and
    `apps/miniprogram`.
  - The "every cross-cutting concern is a package" convention
    (`@repo/auth`, `@repo/email`, `@repo/observability`). Our
    `packages/murmur-core` is the seed of the same idea; the next
    package candidates are already named in their org (`@murmur/notifications`,
    `@murmur/billing`).
  - Their `instrumentation.ts` + Sentry wiring is a clean read for when
    we add a real observability sink.

### create-t3-app — T3 stack scaffolder

- Repo: https://github.com/t3-oss/create-t3-app
- Stars: ~29.0k. MIT. Active.
- Stack: Next.js + tRPC + Prisma + NextAuth + Tailwind + TypeScript.
- Fit: **skip wholesale.** It's a CLI for *new* projects; nothing to
  fork into ours. The opinions don't match (Prisma not Drizzle, tRPC
  not REST). The value here is purely conceptual.
- Worth borrowing: nothing concrete for a mid-build project.

### Better-T-Stack — newer multi-framework scaffolder

- Repo: https://github.com/AmanVarshney01/create-better-t-stack
- Stars: ~5.3k. MIT. Active (latest release v3.27.2, 2026-04).
- Stack: pick-your-own — Next, TanStack, Nuxt, Svelte, Solid, Expo + Hono,
  Express, Fastify, Elysia, Convex + Bun, Node, Workers + Drizzle, Prisma,
  Mongoose + Better Auth, Clerk + Polar (payments) + Turborepo.
- Fit: **skip for the same reason as t3-app, but read its README first.**
- Worth borrowing: it's a useful map of "what is the *modal* 2026
  TypeScript-SaaS stack." The default 2026 picks are Better Auth +
  Drizzle + Hono / Next + Turborepo + Bun + Polar — that's roughly the
  trajectory Murmur is already on. Confirms we're not stack-anachronistic.

### next-saas-starter (now `nextjs/saas-starter` by leerob)

- Repo: https://github.com/nextjs/saas-starter
- Stars: ~15.7k. MIT. Active (last push 2025-12).
- Stack: Next.js 15 + Postgres + Drizzle + Stripe + shadcn/ui + Clerk.
  Closest stack-match to Murmur of any starter in this survey.
- Fit: **borrow patterns, do not fork.**
- Worth borrowing:
  - The Drizzle + Postgres + Next.js wiring is roughly what we already
    do — comparing the schema/migration layout against ours is a good
    sanity gate.
  - Their Stripe webhook handler (`app/api/stripe/webhook/route.ts`) is
    a clean reference for signature verification + idempotency that
    matches what we have to build for RevenueCat / WeChat. **Don't
    copy verbatim** — RevenueCat ≠ Stripe webhook semantics — but it's
    the cleanest reference shape.

### open-saas (wasp-lang)

- Repo: https://github.com/wasp-lang/open-saas
- Stars: ~14.6k. MIT. Active.
- Stack: Built on the **Wasp** framework — a *higher-level* full-stack
  DSL. React frontend + NodeJS backend + Prisma + Stripe/Polar + Auth
  (email + Google + GitHub + Slack + MS) + S3 + Resend email.
- Fit: **skip.** Wasp is the wrong abstraction layer for us — we already
  have a Next.js app and writing in Wasp's DSL would be a rewrite. The
  feature checklist is good marketing for what a "complete SaaS" looks
  like, though.

### Makerkit — paid commercial product, lite version is OSS

- Repo (lite): https://github.com/makerkit/nextjs-saas-starter-kit-lite
- Stars: ~412 (lite). MIT. Active (last push 2026-01-21).
- Stack: Next.js 15 + Supabase + shadcn + Tailwind 4 + Turborepo. The
  *Turbo* paid version is the real product; the lite is intentionally
  trimmed.
- Fit: **skip lite (too thin), don't buy Turbo.** The license terms on
  Turbo (per-developer seat, commercial) and the Supabase coupling make
  it the wrong substrate for Murmur. Worth reading the Turbo course
  docs publicly available on `makerkit.dev` — they have decent prose on
  multi-tenant org models and i18n patterns.

### Supabase — backend platform

- Repo: https://github.com/supabase/supabase
- Stars: ~103k. Apache-2.0.
- Stack: Postgres + GoTrue auth + S3-compatible Storage + Realtime +
  Edge Functions + pgvector.
- Fit: **deferred / parallel-track. Do not adopt as a wholesale backend.**
  Reasons specific to Murmur:
  1. We already have Drizzle + a Python audio worker. Migrating to
     Supabase means abandoning the audio worker's direct Postgres path
     (the worker today writes ledger rows in-tx) or hosting Supabase
     plus our worker (now we run two backends).
  2. China region: Supabase has no mainland PoP, latency + 备案 don't
     work. We'd need a parallel China stack anyway.
  3. Supabase's "RLS-first" pattern is the wrong fit for a payments
     ledger where we want SELECT FOR UPDATE-style transactional
     correctness, not row-level policy.
- What we *do* learn from Supabase: their **Storage SDK** (`@supabase/storage-js`)
  is a clean read for our `lib/storage/` API surface — see Q5 PK table.
  Their API-key naming convention shifted to `publishable / secret` in
  2025; worth mirroring instead of `anon / service_role`.

### NextAuth.js / Auth.js

- Repo: https://github.com/nextauthjs/next-auth
- Stars: ~28.3k. ISC.
- Status: v5 still on the `beta` tag in 2026. The most widely deployed
  Next.js auth library, but the public consensus (StarterPick guide,
  Better Auth comparisons) is that the v5 beta has stayed beta for
  unusually long and the maintainer cadence has slowed.
- Fit: **viable, but not the recommendation.** If Murmur had nothing
  shipped yet I would say "default to Better Auth." Given we already
  have `src/lib/auth/` skeletons and have not yet picked a provider,
  Better Auth is the cleaner pick (next entry).

### Better Auth

- Repo: https://github.com/better-auth/better-auth
- Stars: ~28.6k (now slightly ahead of NextAuth). MIT.
- Stack: Framework-agnostic TypeScript auth framework. **First-class
  Drizzle adapter**, generated schema CLI, organizations, 2FA, passkeys,
  rate limits, Sign in with Apple, magic link, social OAuth (covers our
  needs), session model close to what we already have in
  `src/lib/db/schema/sessions.ts`.
- Fit: **strong adopt candidate — but with a caveat.**
  - Pro: we get most of the auth-substrate work for free, with a Drizzle
    schema generator that mostly matches what's already in
    `src/lib/db/schema/users.ts` + `sessions.ts`.
  - Pro: the StarterPick 2026 comparison flags Better Auth as the
    cleanest pick for new 2026 SaaS work.
  - Caveat: adopting Better Auth means reworking the `external-identities`,
    `sessions`, and `users` tables to match the schema the CLI
    generates. The WIP queries in `src/lib/db/queries/sessions.ts` would
    be partially superseded.
  - Caveat: we ship to Capacitor + 微信. Better Auth has a native
    React (Expo) client and a vanilla JS client; **the Capacitor
    integration is not officially listed** but should work via the
    standard `fetch`-based JS client + cookie / token handling. **The
    微信 MP path is not supported** out of the box; we'd write a
    custom adapter for `wx.request` + 微信小程序的登录态. This is the
    same custom work we'd write against any other JS auth library, so
    it's not a Better Auth-specific tax.
- What to do: see Recommendations §1.

### Lucia

- Repo: https://github.com/lucia-auth/lucia
- Stars: ~10.5k. **Deprecated as of March 2025**; the `lucia` npm
  package carries an official deprecation notice. The maintainer
  rewrote the project as a "how to implement sessions yourself"
  educational resource.
- Fit: **do not adopt as a library.** Worth reading as docs (the
  Copenhagen Book + session patterns it links to are still good
  reading), but not as a dependency.

### Clerk

- Repo: https://github.com/clerk/javascript
- Stars: ~1.7k (the JS SDK only; the company is much larger).
- Managed service, not OSS. Strong DX, pricing is per-MAU after the
  free tier (10k MAU → $25/mo, then scales).
- Fit: **defer.** Clerk + Capacitor works (multiple Next.js + Capacitor
  starters in the wild use it). The downsides for Murmur:
  1. Per-MAU pricing punishes a consumer app that grows quickly.
  2. China region story is poor (Clerk runs out of US-based PoPs).
  3. We lose the "we own the user table" property the current
     `users` schema gives us.
- When to reconsider: if Better Auth's Capacitor / 微信 wiring proves
  significantly harder than expected, Clerk is the managed fallback
  that buys us 2–3 months of focus on product not auth plumbing.

### Convex / Convex Chef

- Convex backend repo: https://github.com/get-convex/convex-backend
  (~11.8k stars).
- Convex Chef (AI app builder): **deprecated in 2026**; the official
  Convex docs publish a "Chef Migration Guide" for existing users.
- Fit: **skip.** Murmur is on Postgres + Drizzle. Convex is a reactive
  document store, the wrong shape for a ledger product, and the
  migration cost from where we are is enormous.

### shadcn/ui

- Repo: https://github.com/shadcn-ui/ui
- Stars: ~115.5k. MIT.
- "Open Code" distribution — components are copy-pasted into your repo,
  not installed as a dep.
- Fit: **adopt incrementally where it already fits.** Murmur's existing
  UI is shadcn-styled but mostly hand-rolled. We should not "install
  shadcn" wholesale, but when we add the App-Store-required surfaces
  (account-delete modal, paywall, review prompt) reaching for
  `npx shadcn@latest add dialog button input form sheet` is the cheapest
  path. Each component is ~200 lines, no runtime dependency.

### Hono + Elysia (only relevant if we move away from Next.js API routes)

- Hono: ~30.8k stars. MIT. Web standards-based, runs everywhere.
- Elysia: ~18.5k stars. MIT. Bun-native.
- Fit: **defer.** Both are excellent, but Murmur's API today is Next.js
  route handlers and that's working. Migrating to Hono or Elysia would
  let us deploy the API as a standalone Bun service (which we eventually
  need per `research-2026-06.md` §9.1 — Capacitor needs a remote host).
  When we carve that out (Phase 5), Hono is the safe choice (already
  used by Better-T-Stack as a default, multi-runtime, large ecosystem).
  Elysia is Bun-only and we'd lock out future Cloudflare Workers / Node
  options.

---

## Q3. Capacitor / iOS App Store frameworks

### Ionic + Capacitor

- Capacitor core: https://github.com/ionic-team/capacitor — ~15.8k stars, MIT, active.
- Ionic Framework: https://github.com/ionic-team/ionic-framework — ~52.5k stars, MIT, active.
- Fit: **Capacitor confirmed.** Already chosen in `cross-platform-strategy.md` §4.2.
  - Ionic UI components are **not** needed — we keep our shadcn-styled
    UI inside the WebView. Adding Ionic would force a rewrite of
    our component layer.
  - The plugin ecosystem under `@capacitor/*` and
    `@capacitor-community/*` is the actual delivery vehicle.

### Capgo — Capacitor ecosystem / cloud

- GitHub org: https://github.com/Cap-go (167 repos).
- Notable plugins:
  - `@capgo/capacitor-audio-recorder` (~7 stars, but actively maintained,
    Capacitor 8+, MPL-2.0). The closest "modern free" recorder.
  - `@capgo/capacitor-social-login` (~208 stars). Bundles Apple/Google/
    Facebook into one plugin. The Capgo docs explicitly position it as
    the replacement for the slow-moving
    `@capacitor-community/apple-sign-in`.
- Capgo cloud: live updates (OTA), backend, CI. Paid service.
- Fit: **plugins, yes; cloud, defer.** Their plugins are credible
  replacements for some community-stale equivalents:
  - Use `@capgo/capacitor-social-login` for Sign in with Apple instead
    of the older `@capacitor-community/apple-sign-in` (167 stars, last
    push 2026-01, slow). Capgo's plugin bundles Apple + Google + Facebook
    and the `cross-platform-strategy.md` notification adapter slate also
    needs Google sign-in.
  - For voice recording, `@independo/capacitor-voice-recorder` (a
    re-architected fork of tchvu3's) is the most recently active option
    (last push 2026-03-28, v8.2.4, supports Capacitor 8 + iOS 15+, SPM
    or CocoaPods). The original `tchvu3/capacitor-voice-recorder`
    (~118 stars) still works but has slower release cadence (v7.0.6
    in mid-2025).
  - Skip Capgo cloud for now. We don't yet need OTA updates, and
    spending engineering hours wiring it before App Store submission is
    premature.

### RevenueCat

- iOS SDK: https://github.com/RevenueCat/purchases-ios — ~3.0k stars, MIT, active.
- Capacitor SDK: https://github.com/RevenueCat/purchases-capacitor — ~231 stars, MIT, active.
- Fit: **adopt.** Already locked in by `payment-topup-feature.md`.
  - Remember the timeout-wrapper requirement from `research-2026-06.md` §6 —
    `Purchases.purchasePackage` can hang forever; wrap every call in
    `withTimeout(...)` from `src/lib/http/deadline.ts`. The deadline
    primitive we already have *is exactly what RevenueCat docs
    informally tell people to roll themselves*. This is one of the
    cases where our substrate is upstream-class.

### Tauri 2 mobile

- Tauri 2 mobile is real but the iOS plugin ecosystem is sparse compared
  to Capacitor. We picked against it in `cross-platform-strategy.md`
  §4.4 and that pick still holds.

### Expo Router — actually a different decision tree

- Expo: https://github.com/expo/expo — ~49.8k stars, MIT.
- Expo Router (file-based routing for React Native + universal apps):
  built into recent Expo SDKs, recommended default for new 2026 RN apps.
- Fit / context: **Expo is a different paradigm — not a Capacitor
  alternative we can drop in.** Expo is **React Native** under the hood.
  Choosing Expo means rewriting every screen from web React + DOM into
  RN's `View / Text / Pressable` primitives. Our recording UI, vibe
  picker animations, particle effects all rely on web APIs that don't
  exist in RN without bridging plugins.

#### Expo vs Capacitor decision tree (the actual call)

```
START.
│
├─ Does your team primarily write web (DOM, CSS, Tailwind) and want
│  one codebase serving Web + iOS + Android?
│   └─ YES (this is Murmur)                            ──▶ Capacitor.
│
├─ Are you mobile-first, no web product, comfortable writing in
│  React Native primitives, and willing to pay EAS Build for managed
│  pipelines?
│   └─ YES                                             ──▶ Expo.
│
├─ Already shipped a Next.js web app and have UI built on DOM/CSS,
│  but want native performance? (this is also Murmur)  ──▶ Capacitor.
│
├─ Need SEO + Web *and* App Store coverage?            ──▶ Capacitor.
│
└─ Mostly using `expo-camera`, `expo-av`, `expo-audio`,
   and already have an RN component library?         ──▶ Expo.
```

For Murmur specifically:

- We already have ~30 React + DOM components and Tailwind 4 styles. RN
  rewrites that work to ~zero.
- Our music engine (Tone.js, Web Audio API path) **does not run on
  React Native** — there is no `OfflineAudioContext` in RN without a
  custom native module.
- The 微信 MP shell is separate either way (no MP runs RN either).
- App Store 4.2: both Capacitor and Expo can pass with the right native
  feature set. The bar is identical.
- SEO: Capacitor lets us keep `next build` for the web shell. Expo's
  web target is real but second-class.

**Conclusion (locks in `cross-platform-strategy.md` §4.2):** Capacitor.
Re-evaluate only if (a) we decide to write a separate native iOS UI
because the WebView audio session keeps fighting us, or (b) we hire RN
talent and decide to abandon the web surface for the mobile-only future.

---

## Q4. 中国端框架

| Repo | Stars | License | Maintenance | Stack | Verdict |
|---|---|---|---|---|---|
| https://github.com/NervJS/taro | ~37.5k | MIT | Active (京东 backed) | React 18/Vue 3 → 微信/百度/支付宝/字节 MP + H5 + RN | **Adopt** |
| https://github.com/dcloudio/uni-app | ~41.5k | Apache-2.0 | Active (DCloud) | Vue.js → 微信/百度/支付宝/字节 MP + H5 + APP + 快应用 | Skip (Vue, not React) |
| https://github.com/Meituan-Dianping/mpvue | ~20.3k | MIT | **Dead** (last commit 2022-03-02, last release 1.4.6 in 2019-05) | Vue.js → 微信 MP | **Do not use** |

Notes:

- Taro 4 (current major) targets React 18, which compiles to MP without
  React 19's new features (server components, transitions). For Murmur
  the MP shell is intentionally a thin "Hum + Save + Pay + Read" surface
  per `cross-platform-strategy.md` §4.3 — React 18 capability is enough.
- Code reuse with the Next.js + React 19 shell: only **pure-TS modules
  from `packages/murmur-core/`** port directly. JSX components have to
  be rewritten against Taro's UI primitives (which mirror MP primitives:
  `View`, `Text`, `Button`, etc., not DOM). This is the carve-out
  rationale in `cross-platform-strategy.md` §5.
- mpvue is officially dead — confirmed by the npm registry (last
  publish 2019-07), the repo's last commit (2022-03), and DCloud's own
  forum threads. **Any phase plan that mentions mpvue should be
  patched.** (Search confirms no current Murmur doc mentions it; this
  note is preventative.)

A real risk worth naming here: **the 微信 MP work-stream is blocked on
legal (网文证 vs 工具 classification), not on framework choice**
(`research-2026-06.md` §5). Selecting Taro now is the cheap call; the
hard part is months of compliance and a registered PRC entity. Doing
the framework work before the legal path clears is wasted effort
beyond a one-week "compiles, can talk to /api/transcribe" spike.

---

## Q5. PK — our substrate vs upstream

For each module in Murmur's working tree, the closest upstream
equivalent, and a honest call on whether ours is better, on par, or
should be replaced.

### `src/lib/storage/` vs Supabase Storage SDK / `@vercel/blob` / Cloudflare R2 SDK

- Our shape: `put / get / delete / url`, three drivers (memory, local-fs,
  s3-compatible), contract tests, `StorageScope = "public" | "private"`,
  `StorageError` with typed codes.
- Closest upstream:
  - `@supabase/storage-js` — `from(bucket).upload / download /
    createSignedUrl / remove`, scope = bucket policy (RLS-based).
  - `@vercel/blob` — single backend (Vercel Blob, which is R2 with markup).
    `put / get / list / del`, presigned-upload story is mature.
  - AWS SDK / R2 native — `PutObjectCommand`, no opinion on key
    conventions or scope.
- Honest call: **keep ours, borrow two ideas.**
  - Our multi-driver shape is a *real* advantage given we need
    `local-fs` for dev + `r2 / s3` for prod-intl + `腾讯云 COS` for
    prod-cn. None of the single-vendor SDKs above gives us that.
  - Borrow #1: rename the conceptual key on object metadata from our
    `meta.scope` to match Supabase's modern split — `publishable / secret`
    is more self-describing than `public / private`. Low-effort change,
    high readability win. (Or *don't* change it and accept the lexical
    cost.)
  - Borrow #2: add a presigned-upload method (`createSignedUrl(key,
    ttl)`) to the contract before Phase 4. Every upstream has it; we
    don't. This is the right time — adding it after the song-upload
    flow is shipped means a contract change.

### `src/lib/rate-limit/` vs `@upstash/ratelimit` / `express-rate-limit` / `@nestjs/throttler`

- Our shape: token-bucket pure decision (`token-bucket.ts`) + an in-memory
  adapter + contract tests + a `RateLimitStore` driver interface
  (memory / redis / postgres).
- Closest upstream:
  - `@upstash/ratelimit` (~2.0k stars) — three algorithms (fixed window,
    sliding window, token bucket); Redis-only as a backend (Upstash or
    self-hosted compatible); great serverless ergonomics; *only* Redis,
    so memory + Postgres adapters are not on offer.
  - `express-rate-limit` — connect-style middleware, single algorithm
    (fixed window by default), Express-coupled (we'd be writing
    adapters to Next.js route handlers anyway).
  - `@nestjs/throttler` — NestJS-coupled, not relevant.
- Honest call: **keep ours, with one borrowed idea.**
  - The pure-decision + store-driver split we have is *cleaner* than
    any of the libraries above. It lets us test the algorithm without
    any I/O.
  - Borrow: Upstash's response shape includes `limit / remaining /
    reset` (Unix timestamp) — we already have `remaining / retryAt /
    retryAfterMs`, but adding `limit` (the capacity, echoed back) to
    our `RateLimitResult` makes it cheaper to render rate-limit headers
    (X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset).
    Cheap to add now, painful to retrofit through every call site
    later.
  - For the eventual Redis + Postgres adapter, Upstash's [token-bucket
    Lua](https://github.com/upstash/ratelimit-js/blob/main/src/algorithm/token_bucket.lua)
    is a *good* reference implementation. Their script is the
    industry-standard atomic recipe; we should port the logic into our
    adapter rather than re-derive it.

### `src/lib/billing/notes-ledger-decisions.ts` (+ `notes-ledger.ts` queries) vs Lago / OpenMeter / Stripe-credits patterns

- Our shape: pure decisions (`decideSpend / decideGrant / decideRefund`)
  + DB orchestration in queries (`refundReferenceFor`, idempotency via
  partial unique index on `(user_id, reason, external_ref)`).
- Closest upstream:
  - **Lago** (https://github.com/getlago/lago) — ~9.8k stars, AGPL-3.0
    server + MIT clients. Full metering + subscription + billing API.
    Stand-alone product, not a library.
  - **OpenMeter** (https://github.com/openmeterio/openmeter) — ~2.0k stars,
    Apache-2.0. Real-time usage aggregation; complementary to a billing
    engine, not a replacement.
  - Stripe-credits pattern — `customer balance` API with manual
    adjustments. Vendor-coupled.
- Honest call: **keep ours; do not adopt Lago.**
  - Murmur's billing surface is *narrow*: one currency (notes), three
    operations (spend / grant / refund), webhook-driven entry, hard
    constraint on idempotency. The pure-decisions split is the right
    fit for that scope.
  - Lago is the right answer when usage events are diverse, pricing is
    plan-based with mid-cycle proration, and you need invoicing /
    dunning. Murmur is *not* that shape — we want a ledger, not an
    invoicing platform.
  - **One concrete idea worth borrowing** from Lago / Stripe-credits:
    expose a `ledger.preview(intent)` that returns the would-be
    `SpendDecision` *without* writing. Today our pure-decision functions
    already do this, but no API surfaces it. A preview route would let
    the client gate the "Save" button on real balance state, not on
    stale `useUserBalance()`. Cheap to add.
  - **One concrete weakness to fix** that other ledgers solve and we
    don't: there is no `LedgerOperation` history projection for the
    user. The current `notes_ledger` table is append-only, but no read
    path exposes "last 50 ledger rows for this user." Add a paginated
    `/api/user/ledger?cursor=...` before Phase 4 ends — it's an
    inevitable customer-support request ("why is my balance N?").

### `src/lib/http/deadline.ts` vs ky / wretch / `AbortSignal.timeout` / undici utils

- Our shape: `withTimeout(promise, ms, { label, signal })`,
  `deadlineSignal(ms, { label, signal })`, `mergeSignals(...)`,
  `TimeoutError` with `kind`, `ms`, `label`.
- Closest upstream:
  - `AbortSignal.timeout(ms)` — built-in, no typed error, no compose
    with parent signal.
  - `AbortSignal.any([...])` — built-in (Node 20+, browser), our
    `mergeSignals` is a thin polyfill / labelled wrapper.
  - `ky` (~16.9k stars) — bundles timeout + retry + abort handling
    *inside the fetch client*, not as primitives. `ky.get(url, { timeout:
    8000 })` is the canonical 80% case.
  - `wretch` — similar to ky.
  - undici / Node — has `request` with `bodyTimeout / headersTimeout`,
    but tied to Node's native http stack, not browser.
- Honest call: **keep ours.** The reason is the second use case — we
  need the same primitive to wrap RevenueCat's `Purchases.purchasePackage`,
  which is not a fetch call. Library timeout-on-fetch helpers don't
  cover that. `withTimeout(arbitrary promise, ms)` is exactly the right
  shape for the RevenueCat hang from `research-2026-06.md` §6.
- One nit worth fixing: our `withTimeout` *doesn't cancel the underlying
  promise*. That's documented in the file but easy to miss. Consider
  exposing `withDeadline(operationFactory, ms)` where `operationFactory`
  is `(signal) => Promise<T>` — the caller can opt into real
  cancellation by wiring the signal into their fetch. Small API
  addition, big DX improvement when wrapping RevenueCat.

### `src/lib/api/base-url.ts` vs tRPC baseUrl resolver / Capacitor community patterns

- Our shape: read `NEXT_PUBLIC_MURMUR_API_BASE_URL`, fall back to `""`
  for relative paths, detect Capacitor at runtime and warn (once) when
  env is missing, expose `resolveApiUrl(input)`.
- Closest upstream:
  - tRPC docs ship a `getBaseUrl()` snippet (literally a snippet, not
    a library) that does the same dance: SSR → `VERCEL_URL` →
    `NEXT_PUBLIC_API_URL`, etc.
  - Capacitor community: there's no canonical library; the typical
    advice is `if (Capacitor.isNativePlatform()) baseURL = "https://..."`
    inside an axios instance.
- Honest call: **keep ours, it's already the right pattern.** The bug
  class this prevents (silent 404 inside Capacitor) is documented in
  `research-2026-06.md` §2 and the implementation matches the cited
  fix. Two minor improvements worth doing:
  1. When `apiBaseUrl()` returns `""` *and* we are running inside
     Capacitor, log a structured event (`log("api.base_url_missing",
     ...)` instead of `console.warn`) so the bug class shows up in the
     observability ring buffer.
  2. Add a Taro / 微信 MP detector branch in `isLikelyCapacitor()` →
     rename to `isLikelyNativeShell()`. The 微信 MP runtime exposes
     `wx` as a global; trivial to detect, important to surface the
     same warning class.

### `src/lib/observability/log.ts` + `recent-events.ts` vs pino / winston / OpenTelemetry / Sentry

- Our shape: a typed `LogEvent` union, `LogContext` interface, JSON
  output, in-memory ring buffer with PII redaction, `recent-events`
  endpoint reads off the ring.
- Closest upstream:
  - **pino** (~17.9k stars, MIT) — the gold standard for JSON logging
    in Node. Faster than what we wrote, zero PII-redaction, no event
    taxonomy enforcement (you can `logger.info({ password: "..." })`
    and pino logs it).
  - **winston** (~24.4k stars, MIT) — older, slower than pino, more
    transports out of the box. Generally moving toward pino across
    the industry.
  - **OpenTelemetry JS** (~3.4k stars, Apache-2.0) — distributed
    tracing + metrics + logs spec. Heavyweight; production sink for a
    metrics platform.
  - **Sentry JS** (~8.7k stars) — error tracking + breadcrumbs +
    session replay. Different shape (events with context, not log
    lines).
  - **PostHog** (~34.8k stars) — product analytics + session replay
    + feature flags. Different shape again.
- Honest call: **keep ours for the typed taxonomy + ring buffer.
  Add pino as the JSON-output sink. Add Sentry for errors.**
  - The typed `LogEvent` union is something neither pino nor Sentry
    offer and it's the most useful thing about our logger — it keeps
    dashboards from rotting when someone renames a string. Don't lose
    this.
  - Replace the hand-rolled `console.info(JSON.stringify(payload))`
    with `pino`. We get faster serialization, better child-logger
    ergonomics, the standard tooling chain (`pino-pretty`,
    `pino-transport`), and a real stream interface for production
    sinks. Net code reduction.
  - For Phase 5+: wire a Sentry transport for `level: "error"` events
    only. Don't double-pay by sending every info log to Sentry. The
    breadcrumb API can pull the most recent N items from our existing
    ring buffer on error capture — that's exactly what the ring buffer
    was designed for.
  - **Concrete weakness today**: our `redact()` only catches keys
    starting with `raw` / `audio` and string lengths > 2048. It does
    *not* catch email addresses in arbitrary fields, IP addresses, or
    base64 audio data passed under a benign key name. Before any
    third-party sink (Sentry, Logflare, etc.) is wired, the redactor
    needs a regex pass for `(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`
    + IPv4/IPv6 + data-URL prefixes. pino has `redact: { paths: [...]
    }` config; combining that with our existing prefix rule is the
    right shape.

---

## Recommendations

Each rec lists **what + why + how**.

### Adopt outright

1. **Better Auth as the auth substrate; reshape `src/lib/db/schema/users.ts`
   + `sessions.ts` + `external-identities.ts` to its generated schema.**
   *Why*: It directly closes the four Phase-3 gating items (Sign in with
   Apple, email/password, sessions, account-delete) with an actively
   maintained library, matches our Drizzle + Bun + Next.js stack, and
   the StarterPick 2026 comparison + Better-T-Stack default both pick
   it as the 2026 leader over NextAuth v5 (still in beta). Lucia is
   officially dead.
   *How*: Land it as a Phase 3 PR that (a) runs `npx @better-auth/cli
   generate` against our Drizzle schema, (b) maps the WIP `users` and
   `sessions` rows by hand into the new shape (writes are localized to
   one migration), (c) wires `@capgo/capacitor-social-login` for Apple
   inside the Capacitor shell, (d) leaves the 微信 MP path as a
   custom adapter slot to fill in Phase 7. Estimate: ~3–4 days for one
   engineer on a clean afternoon, dominated by the schema migration
   not the library.

2. **`@capgo/capacitor-social-login` for Sign in with Apple (and Google
   later), replacing the older `@capacitor-community/apple-sign-in`.**
   *Why*: Active maintenance, unified API across Apple + Google + Facebook
   (we'll need Google for Android), the community plugin's release
   cadence has degraded.
   *How*: One line in `apps/capacitor/package.json` once the Capacitor
   shell exists. Until then, document the pick in
   `cross-platform-strategy.md` §4.2's plugin table.

3. **`@independo/capacitor-voice-recorder` for native iOS / Android
   recording in the Capacitor shell, keeping the web `MediaRecorder`
   path on the web shell.**
   *Why*: Most recent push (2026-03), Capacitor 8 + iOS 15 support, SPM
   compatibility, contract-tested, MIT. Beats both the slower-moving
   `tchvu3/capacitor-voice-recorder` and the new but tiny
   `@capgo/capacitor-audio-recorder` on maturity + cadence.
   *How*: Document in `cross-platform-strategy.md` §4.1.a alongside
   `audio-pipeline-redesign.md`. No code change until the Capacitor
   shell exists.

4. **`pino` as the JSON sink under our existing `log()` helper.**
   *Why*: Keep our typed `LogEvent` taxonomy + redact list, replace
   `console.info(JSON.stringify(...))` with the gold-standard Node JSON
   logger. Faster, better redact API, easier integration with downstream
   sinks. Net code reduction + standard tooling chain.
   *How*: Replace the `console.info / warn / error` block at the end
   of `src/lib/observability/log.ts` with a single pino instance.
   Keep the recent-events ring as-is. Sub-1-hour change.

5. **Taro 4 with React syntax as the 微信 MP shell framework**, contingent
   on the legal 网文证 / 类目 path clearing.
   *Why*: It's the only viable React-targeting MP framework. uni-app is
   Vue, mpvue is dead. This locks in `cross-platform-strategy.md` §4.3.
   *How*: No code work until the 备案 path clears. Until then, the
   only deliverable is a short README in `apps/miniprogram/` explaining
   the gate.

### Borrow ideas, keep our implementation

6. **Storage: add a `createSignedUrl(key, ttlSeconds)` method to the
   `ObjectStore` contract.**
   *Why*: Every upstream (Supabase, R2 SDK, Vercel Blob) has it. We'll
   need it the moment we ship the `POST /api/songs/upload-token` route
   from `api-conventions.md` §6.2. Adding the contract method before
   we have a use forces the adapter authors to think about presigned
   semantics now, not retrofit.
   *How*: Add to `src/lib/storage/types.ts` as an optional method on
   `ObjectStore`. `memory` + `local-fs` return a stub URL; the
   `s3-compatible` adapter calls AWS SDK's `getSignedUrl`. ~half-day.

7. **Rate-limit: add `limit` (capacity echoed back) to `RateLimitResult`,
   port Upstash's token-bucket Lua script when the Redis adapter ships.**
   *Why*: Cheap header parity now (`X-RateLimit-Limit`); avoids a
   future "let me re-derive an atomic token-bucket" yak when we add
   Redis or Postgres.
   *How*: Update `RateLimitResult` in `types.ts`, set `limit:
   opts.capacity` in `token-bucket.ts`. ~1 hour.

8. **Deadline: ship a `withDeadline(factory, ms, opts)` form that takes
   `(signal) => Promise<T>` so callers can opt into real cancellation.**
   *Why*: Closes the documented "we cannot cancel the underlying
   promise" gap. Needed specifically for RevenueCat which exposes
   no signal but does expose a way to call its API repeatedly (we can
   surface `provider_timeout` and retry).
   *How*: ~30 LoC addition to `src/lib/http/deadline.ts`; new tests in
   the same file. Half day.

9. **Observability: harden `redact()` against email / IP / data-URL
   patterns before wiring any third-party sink.**
   *Why*: The current redactor only catches `raw*` / `audio*` keys + 2KB
   strings. Any third-party sink will leak PII the moment a future
   author logs `{ to: user.email }` without thinking.
   *How*: Add regex patterns to `recent-events.ts` redact pass. Reuse
   pino's `redact: { paths: [...] }` syntax. ~1 hour.

10. **Stripe SaaS Starter (leerob's `nextjs/saas-starter`) — read the
    Stripe webhook handler before writing ours for RevenueCat /
    WeChat.**
    *Why*: It is the cleanest reference implementation of webhook
    signature verification + idempotency + Drizzle write that we'll
    find. Don't copy verbatim (semantics differ per provider), but
    use it as a structural sanity gate.
    *How*: Just `git clone https://github.com/nextjs/saas-starter` and
    read `app/api/stripe/webhook/route.ts` before Phase 4 starts. Zero
    code change to our repo.

### Defer (not yet needed)

11. **Clerk as a managed auth fallback.** Only revisit if Better Auth's
    Capacitor or 微信 MP wiring blows up in implementation. Pricing
    + the user-table ownership loss make it a last resort.

12. **Lago / OpenMeter for usage-based billing.** Murmur's billing
    shape (one currency, three ops) does not justify either platform's
    operational overhead. Revisit only if pricing splits into multiple
    SKUs with proration / invoicing requirements.

13. **OpenTelemetry JS.** Heavy for our current scale. Once we have
    distributed services (Next.js API + Python worker + 微信 backend),
    revisit. Until then, structured pino + Sentry is enough.

14. **Trigger.dev / Inngest / BullMQ for queue + scheduled jobs.**
    The current Phase 4 needs are *one* daily refill cron + a
    transcribe-retry on worker timeout. We can ship that with a
    Vercel cron + a Next.js route. Trigger.dev becomes worthwhile when
    we have ≥ 5 distinct background workflows with durable steps.

15. **Hono / Elysia as the API runtime.** Defer until Phase 5 carves
    the API out of Next.js for Capacitor + 微信. At that point Hono
    is the safe pick (multi-runtime); Elysia locks us into Bun.

16. **Capgo cloud (OTA live updates).** Skip until after first App
    Store submission. Live updates are nice but optional; passing 4.2
    is not.

17. **Convex / Convex Chef.** Different shape; Chef is deprecated;
    Convex itself doesn't fit a ledger product.

18. **shadcn/ui wholesale install.** Already cherry-picking. Continue
    to install components on demand rather than vendor the entire kit.

---

## Open questions

These are real ambiguities that the user (not engineering) needs to
settle before the next batch of decisions:

1. **Auth provider preference: Better Auth (adopt + write 微信 adapter)
   vs Clerk (pay, lose the user table, get the wiring done)?** The
   technical recommendation is Better Auth. The non-technical
   considerations are budget tolerance and how soon the iOS deadline
   bites. If the iOS submission target moves inside ~6 weeks, Clerk
   buys time at the cost of a per-MAU bill forever.

2. **Are we willing to break the working WIP user/session schema to
   match Better Auth's generated schema?** Tactically yes (one
   migration), but if there is an undocumented external system already
   reading our `users` table, the migration cost goes up.

3. **微信 MP timing.** Doing any Taro work before 网文证 / 工具
   classification clears is wasted effort. Confirming the legal
   strategy is the prerequisite — engineering can prep but should not
   ship.

4. **Observability vendor.** pino + Sentry is the bottom-up
   recommendation. If the user has a separate preference (Datadog,
   Axiom, Logflare, Better Stack) the sink layer differs but the
   pino + typed-event-taxonomy + ring-buffer floor is the same. Pick
   when we have a logs-volume estimate.

5. **Object-storage region split.** `cross-platform-strategy.md` §7
   says R2 (intl) + 腾讯云 COS (CN). Confirming this means a real
   contract decision about which key the `s3-compatible` adapter
   reads in each environment. Belongs in a separate "infra picks"
   doc, not here.

6. **App Store ID generation strategy.** Sign in with Apple uses an
   opaque user ID; for Murmur to merge that with email/password later,
   we need a clear primary-key strategy. Better Auth provides one
   (`identities` table). We should adopt theirs verbatim unless we
   have a reason to differ.

---

## 11. Out of scope (this survey)

- Cost / pricing modeling for any managed service. Engineering survey,
  not commercial.
- Specific Sentry / Datadog tier picks. Vendor selection happens when
  we have a logs-volume estimate.
- Re-evaluation of audio stack (SwiftF0, DeepFilterNet, pyin) — already
  covered in `research-2026-06.md` §4.
- Cross-platform UI library decisions (Ionic vs raw shadcn). Already
  closed in `cross-platform-strategy.md` §4.2.

---

Sibling docs: `research-2026-06.md`, `cross-platform-strategy.md`,
`engineering-principles.md`, `engineering-standards.md`,
`execution-roadmap.md`.
