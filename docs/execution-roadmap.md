# Execution Roadmap — Murmur v2

Historical note: this roadmap still includes migration steps written while the
worker rename and browser-provider retirement were in progress. Read it as
sequencing context, not as a statement that those legacy paths are still
current architecture.

## 1. Purpose

This file sequences the work specified in the other v2 docs so the
dispatching agent (or a human) knows what to ship first, what blocks what,
and what acceptance signal to look for at each stop.

Read first:

- `docs/archive/diagnosis-2026-06.md` — what is real today
- `docs/audio-pipeline-redesign.md` — new hum → score pipeline
- `docs/cross-platform-strategy.md` — Web + Capacitor + Taro
- `docs/studio-compose-redesign.md` — Compose simplification
- `docs/payment-topup-feature.md` — credits, top-up, billing

This roadmap explicitly **does not** rush UI work. The user's directive:
**"先从逻辑和后端开始."**

## 2. Sequencing principles

1. **Backend correctness first.** The audio result is wrong; until it is
   not, no other work compounds.
2. **Carve before scale.** Pull the algorithm core out of the web app
   before duplicating shells for iOS / 微信 MP.
3. **Pay-walls last on each surface.** Plumb payment after the surface is
   real; never gate something that isn't built.
4. **One reviewable PR per stop.** No phase below should be a single
   monolithic merge.

## 3. Phases

### Phase 0 — Pre-flight (≤2 days)

Goal: lock the foundations the rest depends on. Pure code-prep, no
visible change.

- [ ] Promote the `currentPattern` overload (see diagnosis §8.7) to typed
      fields. Add `melodyPitchSequence`, `chordsTag`, `bassPattern`,
      `drumsPattern`, `texturePreset` on `TrackState`. Migrate one screen
      at a time; `currentPattern` stays for backcompat.
- [ ] Delete dead `/api/transcribe` proxy code and the unused
      `setSongs` redundancy in the store.
- [ ] Add a `region_id` column to `users` table (default `"intl"`).
- [ ] Add `OpenTelemetry`-style structured logs around audio pipeline
      entry points.
- [ ] Add a smoke test that records → transcribes → polishes → assembles
      a known fixture, so we can ship without breaking music output.

**Done when:** `bun run build` clean, smoke test in CI.

---

### Phase 1 — Audio pipeline v2 (2–3 weeks)

Goal: ship the new `/api/transcribe` so a real hum produces a usable
score, with no broad silent fixture masking.

See `audio-pipeline-redesign.md` for component decisions.

Stops:

1. Containerize and deploy the audio worker (current
   `workers/basic-pitch-service/` rename → `workers/audio-engine/`).
2. Add DeepFilterNet-family denoise + silence trim into the worker.
3. Swap pYIN for SwiftF0 as primary; keep pYIN fallback.
4. Port the polish layer into the worker pipeline (server response is a
   complete `ScoredMelody`, not raw notes).
5. Implement `clampToInstrument` + the range table.
6. Update `src/modules/stainer/transcribe.ts` to call only the new
   `/api/transcribe`. Delete browser-yin / browser-basic-pitch /
   remote-python providers.
7. Add the explicit "Try a demo melody" button + a real "couldn't hear
   that" error path on HumScreen. Fixture is no longer a broad silent
   fallback; only a narrow transient rescue path may auto-fire after a
   known-good live success.
8. Add diagnostics (snr, voicedRatio, provider) to MeScreen for
   power users, removed from default view.

**Done when:** acceptance list in `audio-pipeline-redesign.md` §9 passes.

---

### Phase 2 — Compose / Studio simplification (1–2 weeks)

Goal: reduce Studio's 28+ surfaces to the three-plane Compose model.

See `studio-compose-redesign.md` for the layout.

Stops:

1. Add `composeUndoStack` to the store.
2. Build the plane container + swipe / tab.
3. Plane 1 (Listen): hero + 4 meta pills + Tweak link.
4. Plane 2 (Tweak): bento scene grid (press-and-hold preview) + Auris
   single-line input + Undo/Restore micro-pills.
5. Plane 3 (TrackMixer): keep as-is, behind a "Fine-tune" link.
6. Hum → Compose 600 ms autoplay transition.

**Done when:** acceptance list in `studio-compose-redesign.md` §12
passes.

---

### Phase 3 — Auth + Identity (1 week)

Goal: stop trusting `x-murmur-user-id`. Until this is real, no payment
work is meaningful.

Stops:

1. Pick the real identity provider (Sign in with Apple + WeChat OAuth for
   the two shells that need it; Stytch / Clerk / Supabase for web).
2. Replace `src/lib/platform/server-auth.ts` with real session validation
   (header → JWT or session cookie).
3. Migrate existing guest data: `userId = "guest"` rows can either be
   purged or hard-bound to the first authenticated user on the device
   (recommend purge; "guest" is dev-only behavior).
4. Add a `sessions` table or use a provider's managed sessions.

**Done when:** `requireAuth` rejects spoofed headers in tests; existing
flows still work for authenticated users.

---

### Phase 4 — Payment + top-up (2–3 weeks)

Goal: ship the credit system end-to-end on the web shell. Native shells
adopt it in Phase 6.

See `payment-topup-feature.md` for the spec.

Stops:

1. Schema: `notesBalance` on users, `notesLedger`, `purchases`. Migration
   grants 50 notes to existing users (the v2 cutover gift).
2. Build the `/topup` + `/topup/checkout` web routes.
3. Stripe Checkout integration + webhook → ledger.
4. Add the `spendNotes` transaction helper and gate
   `/api/transcribe`, `/api/strummer/edit`, `/api/songs`.
5. Hourly free-refill cron.
6. MeScreen update: balance + top-up link replaces debug runtime row.
7. Studio Save button reflects gating when balance < 1.
8. End-to-end test with Stripe sandbox.

**Done when:** acceptance list in `payment-topup-feature.md` §10 passes.

---

### Phase 5 — Carve `packages/murmur-core` (1 week)

Goal: extract the shareable algorithm core so the upcoming shells can
re-use it.

See `cross-platform-strategy.md` §5 for the carve-out.

Stops:

1. Create `packages/murmur-core/` as a workspace.
2. Move pure-TS files (types, polisher port if still TS, EditTokens,
   instrument ranges, arrangement helpers, i18n dict) in.
3. Move `murmur-api-client/` next to it.
4. Update web shell imports to use the new package.
5. Verify build, lint, tsc pass identically.

**Done when:** `packages/murmur-core` builds standalone, web shell still
ships, no behavior change visible to users.

---

### Phase 6 — Capacitor shell (3–4 weeks)

Goal: iOS TestFlight + Play internal track build. App Store review starts
the clock here.

See `cross-platform-strategy.md` §4.2.

Stops:

1. `apps/capacitor/` scaffold (ios + android).
2. Static-export the web shell to `apps/capacitor/www/`.
3. Wire native plugins: media, preferences, share, filesystem,
   in-app-review.
4. RevenueCat integration → Apple StoreKit, Google Play Billing.
   Backend webhook → ledger.
5. Native audio capture fallback if Web `MediaRecorder` is unreliable in
   WKWebView. (Detect → use plugin path.)
6. Submit to TestFlight; submit internal alpha to Play.
7. Beta period (one week minimum) before App Store production.

**Done when:** acceptance list in `cross-platform-strategy.md` §10 passes
for iOS + Android shells.

---

### Phase 7 — 微信小程序 shell (4–5 weeks)

Goal: ship a Hum + Save + Gallery + Top-up MP. Studio edits are MP v2.

See `cross-platform-strategy.md` §4.3.

Stops:

1. Deploy a 腾讯云 region of the audio worker + Next.js API + Postgres
   replica.
2. `apps/miniprogram/` Taro scaffold (React syntax).
3. Implement Hum (`wx.getRecorderManager`) → upload → ScoredMelody → save.
4. Gallery list (reads `/api/songs` via the allow-listed domain).
5. Top-up page (`wx.requestPayment` + WeChat Pay webhook).
6. Pass WeChat 小程序审核 review.

**Done when:** the MP is published, audio quality matches Web, top-up
end-to-end works, daily free refill mirrors the Web.

## 4. Parallelism

Phases can mostly run sequentially, but a few branches are safe to fan
out:

- Phase 2 (Compose) can run in parallel with Phase 1 if a second agent
  handles it; they touch separate files.
- Phase 3 (Auth) and Phase 5 (Carve) can run in parallel after Phase 1.
- Phase 6 (Capacitor) and Phase 7 (MP) can run in parallel after Phase 5,
  but only if the team has two distinct ownership lanes.

## 5. What this roadmap deliberately defers

These are real product gaps that show up in the diagnosis or the brief,
but they do not belong in v2:

- Subscription tier (post-credits).
- Notification publisher (the stub stays a stub until users ask).
- Polyphonic input.
- Gifting / social.
- Desktop / Tauri shell.
- 抖音 / 支付宝 mini-programs.

If a future brief picks these up, they slot after Phase 7.

## 6. Per-phase definition of "ready to dispatch"

A downstream agent can pick up any phase as long as:

1. The previous phase's acceptance list is satisfied.
2. The phase's sibling doc has been re-read for any spec changes since
   this roadmap was authored.
3. The dispatching human or agent has chosen the deploy targets where
   the phase asks for one (see the audio + cross-platform docs).

## 7. Watch-items across phases

These do not belong to a single phase but must not be dropped:

- **Object storage migration:** move `mp3DataUrl` out of Postgres and
  into S3 / R2 / 腾讯云 COS *before* user count makes this expensive.
  Recommend during Phase 4 (we are touching billing/storage anyway).
- **Quota observability:** ship a tiny `/admin/quotas` view that shows
  daily transcription cost vs revenue. Lands during Phase 4.
- **App Store review prep:** start screenshots, copy, privacy nutrition
  label during Phase 5 so Phase 6 isn't blocked on it.
- **Localization gap audit:** before MP ships (Phase 7), every user-
  visible string must have a Chinese translation. Today `dict.ts` is
  mostly bilingual, but new payment + auth strings will lag.

## 8. Cross-reference index

| If you are about to… | Read |
|---|---|
| Change an audio component | `audio-pipeline-redesign.md`, `archive/diagnosis-2026-06.md` §2 |
| Change a Compose surface | `studio-compose-redesign.md`, `archive/diagnosis-2026-06.md` §3 |
| Wire payment in any shell | `payment-topup-feature.md`, `cross-platform-strategy.md` §9 |
| Spin up a new shell | `cross-platform-strategy.md`, `audio-pipeline-redesign.md` §4.1 |
| Touch DB schema | `payment-topup-feature.md` §4, `archive/diagnosis-2026-06.md` §5 + §7 |

Sibling docs are the spec; this roadmap is the order.
