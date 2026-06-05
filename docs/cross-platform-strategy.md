# Cross-Platform Strategy — Web / iOS / Android / 微信小程序

## 1. Goal

Murmur today is a web app only. The product brief calls for shipping to:

1. Web (the current surface).
2. iOS App Store.
3. Android (Play Store + China app stores eventually).
4. **微信小程序** (WeChat mini-program).

This document chooses the framework path, separates "one shared codebase"
from "where we accept a parallel codebase," and locks in the architectural
moves that make the future cheap.

It is paired with `audio-pipeline-redesign.md` — the audio decisions there
assume the runtime decisions here.

> **Reality check (2026-06):** `docs/research-2026-06.md` audits this plan
> against external 2026 evidence on App Store reviews, WKWebView audio,
> 微信 MP 备案 / 网文证, and RevenueCat hangs. Sections below carry inline
> `@research-2026-06` notes where the original wording was too optimistic.

## 2. The forcing constraints

Two non-negotiables drive the rest:

1. **微信 MP cannot run a generic WebView.** It runs a sandboxed JS engine
   with its own UI primitives (`view`, `text`, `button`, etc.), its own
   navigation, no DOM, no `MediaRecorder`, no `OfflineAudioContext`, no
   `fetch` to arbitrary domains without prior allow-listing. A
   Next.js + Capacitor app cannot be poured into a mini-program. There
   *has* to be a parallel mini-program shell.

2. **iOS audio + StoreKit + App Store review.** Apple wants the app to use
   native APIs for the things it taxes (in-app purchase, notifications,
   audio session). Any solution that ships only a WebView must still
   bridge those.

Together: there is no single "write once" framework that covers all four
surfaces with audio + payment. The pragmatic answer is **two shells around
a shared logical core**.

## 3. Architecture: thin shells, fat backend

```
                    ┌──────────────────────────────────────┐
                    │           Murmur Backend             │
                    │   (Next.js API routes + Postgres +   │
                    │    Python audio worker + payment)    │
                    └──────────────────────────────────────┘
                       ▲              ▲              ▲
                       │              │              │
       ┌───────────────┘              │              └─────────────┐
       │                              │                            │
┌──────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│  Web (PWA)   │         │  iOS / Android      │         │  微信小程序       │
│  Next.js +   │         │  Capacitor wrap     │         │  Taro (React) +  │
│  React 19    │         │  of Next.js export  │         │  parallel shell   │
└──────────────┘         └─────────────────────┘         └──────────────────┘
        \________________________/                              │
                  shared web codebase                           │
                                                                ▼
                                              (own UI tree; talks to backend
                                               via http with allow-listed
                                               domains)
```

**Single source of truth for product logic = the shared melody contract plus
the backend.** Payment, quotas, storage, and the highest-confidence audio path
live on the backend. Each shell owns **capture + playback + UI**, and capable
clients may run a lighter local melody pass for fast preview or privacy-first
operation as long as they preserve the same contract.

This keeps Murmur portable without forcing every inference step onto the server.
Cloud mode remains the reference-quality path; device mode exists to reduce
latency, reduce backend pressure, and support stronger local experiences on
capable hardware. See `humming-engine-v2.md`.

## 4. Per-target framework choice

### 4.1 Web — stay on Next.js (App Router)

Current stack is healthy.
[package.json](../package.json) shows Next 16 + React 19
+ Tailwind 4 + Bun. No reason to migrate.

Migration the v2 plan *does* need on the web:

- Static export support so Capacitor (§4.2) can wrap the same build.
  Set `output: "export"` in `next.config.ts` for the routes Capacitor
  uses. Keep dynamic API routes server-side; the mobile shell hits them
  remotely.
- PWA manifest + service worker for installability and "share to
  home screen" parity with the App Store version. Use
  `next-pwa` (or any modern equivalent at the time of work).

### 4.2 iOS + Android — Capacitor 7+

**Decision: Capacitor**, not React Native / Expo, not Tauri.

Why:

| Criterion | Capacitor | Expo/RN | Tauri 2 mobile |
|---|---|---|---|
| Reuses Next.js code | ~95% | rewrite UI | rewrite UI |
| Audio recording plugin | mature (`@capacitor-community/media`, `@capgo/capacitor-audio-recorder`) | mature (`expo-av`) | thin, early |
| Web ↔ mobile parity | excellent (WebView) | requires platform divergence | requires divergence |
| Team familiarity | web devs ship it | needs RN expertise | needs Rust + web |
| App Store readiness | proven | proven | maturing |
| Build pipeline overhead | low (one repo) | higher (separate runtime) | medium |

Capacitor wraps the Next.js static export in a native WebView, adds native
plugins for the things only native can do (audio session, IAP, push), and
ships through the standard Apple / Google pipelines. Worse codepaths than
RN for graphics-heavy work — irrelevant for Murmur, where the heavy work is
audio and the visuals are CSS gradients + canvas particles.

Plugins to wire from day one:

- `@capacitor-community/media` — recording + playback session.
- `@capacitor/preferences` — local kv (replaces `localStorage` semantics on
  iOS where WebView storage is volatile).
- `@capacitor/share` — share-sheet for song HTML / poster.
- `@capacitor/filesystem` — download exported audio.
- `@capacitor/in-app-review` — App Store rating prompt.
- StoreKit-compatible IAP plugin (`@revenuecat/purchases-capacitor` is the
  pragmatic pick; see `payment-topup-feature.md`).

#### App Store 4.2 — minimum-functionality gate (`@research-2026-06` §1)

In 2026 a pure WebView wrap of a Next.js site is treated as a "web clip"
by App Store review and rejected under Guideline 4.2 within 2–3 days.
Passing review now requires **at least three** of the following native
features. For Murmur, the slate that meets the bar is:

| Feature | Source | Status |
|---|---|---|
| APNs push notifications | `@capacitor/push-notifications` | required (notifications adapter must ship) |
| Native microphone capture | Capacitor voice-recorder plugin (§4.1.a) | required (also fixes iOS WebView audio gaps) |
| Sign in with Apple | `@capacitor-community/apple-sign-in` | required (auth-substrate, Phase 3) |
| Native share sheet | `@capacitor/share` | already listed above |
| In-app browser for any external link | `@capacitor/browser` | required — never punch out to Safari |
| Offline gallery cache | `@capacitor/preferences` + service worker | nice-to-have |

App Store hard rules to encode in this shell:

1. Web content is **bundled into the IPA** (no `server.url` pointing at
   `https://murmur.app` in `capacitor.config.ts` for production builds).
2. Login + payment never open Safari directly. Use the Browser plugin
   (`SFSafariViewController`) if a web flow is unavoidable.
3. Digital goods (notes top-up) go through StoreKit IAP, not the
   in-app Stripe checkout.

#### 4.1.a Native audio capture (`@research-2026-06` §3)

WKWebView's `MediaRecorder` supports MP4 (AAC) only — WebM/Opus is
unsupported and Apple's WebM PR is preference-gated, not shipping. In
Capacitor we additionally need `NSMicrophoneUsageDescription` in
Info.plist plus a permission prompt on first launch.

Empirically the most reliable path is a **native recorder plugin** (e.g.
`@independo-gmbh/capacitor-voice-recorder` or
`@capgo/capacitor-audio-recorder`) on Capacitor iOS / Android, with the
existing web `MediaRecorder` fallback chain retained for the web shell.
Both emit `audio/mp4` (M4A) on iOS and `audio/aac` on Android; the worker
already decodes both via `pydub`.

#### Static export consequences (`@research-2026-06` §2)

Setting `output: 'export'` in `next.config.ts` is mandatory for
Capacitor, and that mode disables Server Actions, Cookies, Rewrites,
Redirects, Headers, ISR, dynamic API routes, and the default Image
loader. Every current `src/app/api/*` route **does not exist** in the
Capacitor build.

The static export therefore depends on a remote API host that:

- Echoes `capacitor://localhost` (iOS) and `http://localhost` (Android)
  in `Access-Control-Allow-Origin`, or accepts requests through the
  Capacitor HTTP plugin (which patches `fetch` to native HTTP and
  bypasses CORS).
- Resolves through `src/lib/api/base-url.ts` so the same client code
  uses relative paths on the web shell and an absolute URL in the
  native shell.

### 4.3 微信小程序 — Taro 4 (React syntax)

**Decision: Taro 4** with the React syntax mode.

Why not uni-app: Vue-first. Our team and codebase are React.
Why not the raw 微信原生开发: we'd be writing a third UI from scratch.
Why Taro: it lets us write React-syntax components and compile to 微信 MP,
H5, RN, and other mini-program targets. The community + plugin ecosystem
is the strongest of the cross-mini-program tools.

What does **not** port from the web shell:

- The Tone.js renderer (no `OfflineAudioContext` in MP).
- The browser YIN engine (no `decodeAudioData`).
- Routing and layouts (different primitives).
- Any DOM-based code (visualizer canvas needs `wx.createCanvasContext`).

What **does** port unchanged:

- All backend calls (audio transcription, song CRUD, payment).
- Pure-TS algorithm files (none of them touch the DOM): the polisher,
  the Strummer apply-edit logic, the i18n dict, the EditToken types.

Operating mode for 微信 MP: **server-side audio.** The MP records via
`wx.getRecorderManager`, uploads to `/api/transcribe`, gets back a
`ScoredMelody`, sends the user a server-rendered MP3 (no live preview in
MP v1; just the saved song). This is the only reason the audio pipeline
must go server-side (§3, and the audio doc).

Initial MP scope: read-only Gallery + Hum + Save + Pay + Top-up. Studio
edits land in MP v2 once the LLM edit flow is mature.

#### 4.3.a 备案 + 类目 reality (`@research-2026-06` §5)

The 微信 MP "音乐 / 电台 / 有声读物" category is a pre-approved class
that requires **《网络文化经营许可证》** ("网文证") from the provincial
文化和旅游厅 before ICP filing is accepted. In practice 网文证 needs a
PRC-domiciled company with paid-in capital ≥ ~1 000 000 RMB and dedicated
compliance staff, with approval taking 1–3 months.

The defensible alternative for Murmur is the **工具 / 创作辅助** family
(user-original melody arranger, not a music streaming service). Whether
that classification clears 微信 review depends on the specific category
words and the reviewer; this is a legal-counsel call before submission,
not a self-serve engineering decision.

ICP 备案 itself is still required regardless of which class clears.
This means:

- A registered .cn domain pointed at a mainland Chinese host (腾讯云 /
  阿里云) — this is the hard prerequisite for 微信 MP, not Taro.
- MIIT short-message verification (12381) inside 24 h or the filing
  resets.
- 企业 ICP (not individual) for any paid product.

Until 备案 + 网文证 paths are decided, the 微信 MP work-stream stays
**blocked on legal**, not on engineering. The engineering work is
unblocked once those documents exist.

### 4.4 Why not Tauri / Flutter / native

- **Tauri 2 mobile** is exciting (~5 MB binaries, fast) but its mobile
  support is still maturing. We pay the cost of Rust onboarding plus
  rewriting our UI primitives.
- **Flutter** would require rewriting everything in Dart, including the
  arrangement engine. Loses every line of TS we already shipped.
- **Native iOS/Android** doubles team cost. Not a v2 conversation.

Revisit Tauri if we ship a desktop "Studio Pro" variant or need a tiny
embedded build for radio kiosk-style demos.

## 5. Repo layout

Recommended layout once shells exist:

```
murmur/                              # this repo (existing)
├── src/                             # Next.js web app
├── workers/audio-engine/            # Python audio worker (see audio doc)
├── packages/
│   ├── murmur-core/                 # NEW: pure TS, no React, no DOM
│   │   ├── types/                   # MelodyNote, CleanMelody, ScoredMelody…
│   │   ├── arrangement/             # Strummer apply-edit, generate-versions
│   │   ├── instrument-ranges/       # range table from audio doc
│   │   └── i18n/                    # dict, translator
│   └── murmur-api-client/           # NEW: thin fetch wrappers for /api/*
├── apps/
│   ├── capacitor/                   # NEW: Capacitor wrapper + plugins
│   │   ├── ios/
│   │   └── android/
│   └── miniprogram/                 # NEW: Taro project, depends on murmur-core
└── docs/
```

`packages/murmur-core` is the carve-out moment. Everything Hum / Vibe /
Studio shells need from the algorithm layer becomes a published
intra-repo workspace. **No DOM, no React imports, no `window`.** Then:

- web shell: imports `murmur-core` directly.
- Capacitor shell: same web codebase, gets `murmur-core` for free.
- Taro shell: imports `murmur-core`, ships its own UI components.

This is the carve-out the user described as "整体提升产品的产品化程度":
the algorithm becomes the product, the shells become the surfaces.

## 6. Sequencing — which surface first

Recommended order:

1. **Server-authoritative audio pipeline + Web shell (the current repo).**
   Everything else inherits from this. No multi-platform work happens
   before the backend is sane.
2. **Carve `packages/murmur-core`.** Mechanical refactor; no behavior
   changes. PR-sized.
3. **Capacitor shell — iOS first.** App Store review is the slowest path;
   start the clock. Android comes near-free after.
4. **微信小程序.** Last because (a) the audio backend must be in China
   physical region for latency, which forces a deploy decision; (b)
   payment integration is its own meaningful chunk.

This sequencing also matches funding / pay-off: iOS unlocks IAP revenue;
WeChat MP unlocks China-domestic distribution. Web stays the "main"
surface and the marketing landing.

## 7. Hosting + region

The audio worker, Next.js API, and Postgres need to be reachable from all
shells. Practical answer:

- **Primary deploy:** Vercel for Next.js + a Fly.io / Railway region for
  the audio worker (CPU-heavy, not edge-friendly). Same Postgres
  (Neon / Supabase / 腾讯云 PostgreSQL).
- **China replica (for 微信 MP):** a 腾讯云 region with the same audio
  worker image and a separate Postgres. Routing decision by user
  geography on first request (Accept-Language + IP).

Until the WeChat MP ships, single-region is fine. Plan the data model
multi-tenant from day one (`region_id` on user table) so the future split
is mechanical.

## 8. Audio capture API matrix

| Surface | Capture API | Format out | Server-side decode handles? |
|---|---|---|---|
| Browser (desktop) | `MediaRecorder` | `audio/webm;codecs=opus` (or `mp4` fallback) | yes — `pydub` + ffmpeg |
| Browser (iOS Safari) | `MediaRecorder` | `audio/mp4` (AAC, WebKit-only) | yes |
| Capacitor iOS (native plugin) | `capacitor-voice-recorder` (native AVAudioSession) | `audio/mp4` (M4A / AAC) | yes |
| Capacitor Android (native plugin) | `capacitor-voice-recorder` | `audio/aac` | yes |
| 微信小程序 | `wx.getRecorderManager({format:'mp3'})` | `mp3` | yes |

All four arrive at the same `/api/transcribe` endpoint. The server already
detects format from header + extension (see Python worker's
`decode_audio`). No protocol divergence in the algorithm.

`@research-2026-06` §3 explains the iOS-WebView mp4-only constraint and
why the Capacitor shell uses the native plugin instead of leaning on the
WebView `MediaRecorder`.

## 9. Payment integration matrix

Detailed in `payment-topup-feature.md`. Cross-platform summary:

| Surface | Payment provider | Notes |
|---|---|---|
| Web | Stripe (international) + WeChat Pay JSAPI (China) | dual provider |
| iOS | **StoreKit IAP via RevenueCat** | App Store mandates StoreKit for digital goods |
| Android | Google Play Billing via RevenueCat | mirrors iOS |
| 微信小程序 | 微信支付 (mini-program API) | the only allowed provider in MP |

The product needs a unified `entitlement` model on the backend so the
front-end never asks "which payment provider did the user use" — it asks
"what is the user's entitlement state right now." RevenueCat handles
Apple/Google + a webhook into our backend; we layer WeChat Pay on top.

## 10. Acceptance criteria (this phase)

A downstream agent has shipped this strategy when:

- [ ] `packages/murmur-core` exists, web shell imports from it, no DOM /
      React references in `murmur-core`.
- [ ] `src/lib/api/base-url.ts` (or successor) drives every fetch — web
      shell stays on relative URLs, native shell hits the deployed
      remote API. No hard-coded `/api/...` outside this helper.
- [ ] Remote API host is deployed and CORS-allows `capacitor://localhost`
      and `http://localhost` (or every Capacitor call goes through the
      Capacitor HTTP plugin).
- [ ] App Store 4.2 native-feature slate ships: APNs push, Sign in with
      Apple, native voice recorder plugin, in-app browser for external
      links, native share. App Store Connect review notes list them
      explicitly.
- [ ] Capacitor iOS build bundles web content into the IPA (no
      `server.url` in production `capacitor.config.ts`).
- [ ] Capacitor iOS build runs the Hum → Vibe → Studio → Save → Gallery
      flow end-to-end against the deployed backend.
- [ ] Capacitor app published to TestFlight + Google Play internal track.
- [ ] Audio capture works on iOS Safari, Android Chrome, Capacitor iOS,
      Capacitor Android against the same `/api/transcribe`. Capacitor
      iOS / Android use the native voice recorder plugin (not the
      WebView `MediaRecorder`).
- [ ] Taro mini-program scaffold compiles, imports `murmur-core` types,
      and successfully uploads a recording to `/api/transcribe`.
- [ ] One `region_id` column added to `users` table.
- [ ] 备案 + 网文证 path for the 微信 MP region is decided by counsel
      (engineering blocker for any China-region launch).

## 11. Out of scope (v2)

- Native iOS / Android rewrites.
- Apple Watch / Wear OS / TV companions.
- Desktop Tauri build.
- React Native runtime.
- 支付宝小程序 / 抖音小程序 — Taro can compile to them but v2 ships only
  WeChat.
- Offline-first sync. v2 assumes connectivity for transcription.

## 12. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebView audio recording broken on iOS Safari WKWebView | medium | Capacitor plugin path is native and bypasses WebView API |
| 微信 MP package size limit (2 MB / 8 MB main) | high | keep MP shell minimal; assets come from backend; reuse only logic from murmur-core |
| App Store reviewer flags "external payment" if Stripe is left in iOS app | high | gate WeChat / Stripe links behind a "Web" surface marker; IAP is the only iOS path |
| **App Store 4.2 "minimum functionality" rejection** | **high (2026 enforcement is strict)** | ship the §4.2 native-feature slate before first submission; list them in App Review notes |
| **Capacitor build hits 404 on every `/api/*` route** | **certain if unmitigated** | `apiBaseUrl()` helper + remote API host + CORS allow-list; covered in §10 acceptance |
| **`Purchases.*` (RevenueCat) hangs forever on cold start with no network** | **medium-high** | wrap every call in `Promise.race` with 8 s timeout, surface `provider_timeout` to UI |
| **微信 MP blocked at 备案 by 网文证 requirement** | **high if 音乐 class chosen** | classify as 工具 / 创作辅助 (counsel-reviewed); engineering work stays unblocked, distribution gates on the legal docs |
| Backend in US-only region → 微信 MP latency unusable in China | medium | bake `region_id` into models on day one; lift workers to 腾讯云 when MP ships |
| Capacitor WebView storage cleared by iOS | low | replace `localStorage` reads with `@capacitor/preferences` in shared client |
| **DeepFilterNet upstream stalls and breaks against torchaudio 2.6+** | low (today) / medium (year-out) | freeze worker Docker base image; evaluate RNNoise / Krisp as replacement before relying on a year-old pin |

## 13. Open questions

1. RevenueCat vs Adapty vs raw StoreKit — final pick during payment phase.
2. Does the Taro shell ship the same translation dict, or a slimmer one?
3. Do we publish to 苹果中国 App Store separately (ICP, etc.)? Almost
   certainly required for China growth.
4. Notification strategy in Capacitor vs MP — out of scope here, but
   gates the "daily digest" route already stubbed in
   `/api/notifications/cron/daily-digest/`.

Sibling docs: `audio-pipeline-redesign.md`, `payment-topup-feature.md`,
`execution-roadmap.md`.
