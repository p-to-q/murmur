# Research — v2 cutover risk audit (2026-06)

Status: synthesis of a one-day external research pass across product peers,
review-process gotchas, audio stack reality, China-specific compliance,
cross-platform IAP, and storage economics. Sources cited inline.

This doc complements the v2 docs already in `docs/`. Where this doc
disagrees with an earlier doc, the relevant earlier doc gets an inline
`@research-2026-06` admonition pointing here and is patched in the same
PR. The doc itself is read-only after merge — new findings get a new
`docs/research-<yyyy-mm>.md`.

## 0. Why this exists

The v2 docs are good at "what to build." They are intentionally thin on
"what kills you while you build it." This pass surfaces the kill-shots
the planning agent could not have caught from inside the repo, in three
buckets:

1. **Distribution traps** — App Store 4.2, Next.js static-export
   limitations, microphone capture across WebKit.
2. **Tech-stack maintenance / licensing risk** — DeepFilterNet upkeep,
   SwiftF0 licensing, RevenueCat hangs.
3. **Cost + compliance reality** — object-storage egress economics,
   China 网文证 / 类目, music-copyright climate post-UMG-v-Udio.

Each section ends with **Repo action** lines pointing at the concrete
file or doc change this PR makes.

---

## 1. App Store review risk for a Capacitor-wrapped Next.js shell

### Findings

- Apple's Guideline 4.2 "Minimum Functionality" is the **most common
  rejection** for Capacitor / Cordova / Expo apps that wrap a web view
  with no native affordances. Reviewers explicitly look for "feels like
  Safari with a logo" patterns and reject within 2–3 days. By 2026 the
  enforcement has tightened further; passing now typically requires
  **≥ 3 native features** of the following list: push notifications,
  native navigation, biometrics, offline cache, camera / mic / sensors,
  share extension, haptics, dark mode, deep-links, widgets / live
  activities.
  Sources: `code2native.com/blog/webview-app-apple-app-store-checklist`,
  `iossubmissionguide.com/guideline-4-2-minimum-functionality/`,
  `publishd.app/blog/why-wrapping-a-web-app-doesnt-work`,
  `publishmymobileapp.com/guides/publish-capacitor-app-on-app-store/`.

- Capacitor-specific 4.2 traps:
  - Loading **external URLs at the root** (vs bundling the web build
    locally to `webDir`) is treated as a web clip. Web content must
    ship inside the IPA; the only runtime network calls allowed without
    risk are API calls, not full-page loads.
  - Sending users **out to Safari** for login, payment, or content
    causes rejections. The Capacitor `Browser` plugin
    (`SFSafariViewController`) is the accepted in-app browser path.

- Push notifications are the single highest-leverage 4.2 mitigation.
  Murmur today has a `notifications` adapter stubbed; it is in the
  critical path for App Store approval, not a nice-to-have.

### Implications for Murmur

- The web shell ships through Capacitor only after we wire **at least
  three of**: APNs push (notifications-rebound or new song reminders),
  Sign in with Apple (auth-substrate work in Phase 3), mic capture via
  a Capacitor plugin (Phase 6 native fallback in
  `cross-platform-strategy.md` §4.2), share sheet (Capacitor Share
  plugin), and offline cache of the user's own gallery.

- The Save → Top-up flow must not punch out to Safari to complete
  payment — Apple's IAP path is mandatory for digital goods, which we
  already plan through RevenueCat → StoreKit, but the doc and code
  should never present a "buy on web" affordance inside the iOS shell.

### Repo action

- Patch `docs/cross-platform-strategy.md` §4.2 with the explicit "≥ 3
  native features" gate as App Store hard requirement, not optional
  polish.
- Add a `DEPRECATIONS.md` row for any future code that opens external
  URLs from the iOS shell.

---

## 2. Next.js static-export reality (vs Capacitor)

### Findings

- Capacitor requires `next.config` to set `output: 'export'`. Under
  that mode, Next.js documents these features as **unsupported**:
  Server Actions, Cookies, Rewrites, Redirects, Headers, Proxy, ISR,
  Image Optimization with the default loader, Draft Mode, Intercepting
  Routes, dynamic routes that need `Request`, route handlers that read
  `Request`.
  Source: `nextjs.org/docs/app/guides/static-exports`,
  `github.com/vercel/next.js/discussions/67503`.

- Every route in `src/app/api/` (transcribe, songs, strummer/edit,
  auth/me, auth/logout, user/balance, user/profile, notifications,
  mcp, observability/recent-events) **does not exist** in the
  Capacitor build. Static export simply skips them. There is no
  "they fail" failure mode — they are absent from the bundle.

- This is invisible at `bun run build` today because we build with
  `output` left default; the moment we add `output: 'export'` for
  Capacitor, the routes vanish. Murmur today reaches every API route
  through relative paths (`/api/transcribe`), which inside Capacitor
  resolves to `capacitor://localhost/api/transcribe` on iOS and
  `http://localhost/api/transcribe` on Android. Both return 404.

- The accepted solution is a **remote API host** + a CORS / Capacitor
  HTTP plugin. Capacitor default origins are `capacitor://localhost`
  (iOS) and `http://localhost` (Android); the remote backend must
  echo back both in `Access-Control-Allow-Origin`. Alternatively, the
  Capacitor HTTP plugin patches `fetch`/`XMLHttpRequest` to use
  native HTTP and bypasses CORS entirely.
  Sources: `ionicframework.com/docs/troubleshooting/cors`,
  `forum.ionicframework.com/t/how-works-cors-in-capasitor-on-real-devices/230474`.

### Implications for Murmur

- We need an `apiBaseUrl()` helper **now**, even before Phase 6, so
  the same `request()` wrapper works in three modes:
  - Web shell: `""` (relative paths, current behavior).
  - Capacitor: `https://api.murmur.app` (or per-region; CN region
    different).
  - 微信 MP: a domain on the WeChat allow-list.
- This is one of the few research items that has a code fix worth
  doing in the same PR as this doc, because the absence of it would
  cause the Capacitor shell to throw 404s on every page hit and we'd
  spend a day rediscovering this.

### Repo action

- New `src/lib/api/base-url.ts` with a typed `apiBaseUrl()`,
  consumed by `src/lib/api/request.ts`. Test coverage for web /
  capacitor-ios / capacitor-android / wechat-mp branches.
- Patch `docs/cross-platform-strategy.md` to flag this as the
  earliest Capacitor-blocking work item.
- Patch `docs/api-conventions.md` §11 with the "all routes are
  reachable from a remote host" implicit assumption.

---

## 3. iOS WKWebView audio capture reality

### Findings

- iOS Safari / WKWebView's `MediaRecorder` supports **MP4 (AAC) only**.
  WebM/Opus is unsupported as of mainline WebKit, and Apple's
  in-progress WebM PR (#34905) is behind a preference, not shipping
  by default.
  Sources: `webkit.org/blog/11353/mediarecorder-api/`,
  `dev.to/alexneamtu/how-we-made-screen-recording-work-on-every-browser`.
- `getUserMedia` is exposed inside WKWebView only when the embedding
  app is configured to natively capture audio (Info.plist
  `NSMicrophoneUsageDescription` set + native permission granted).
  Web shell capture works in Safari; in Capacitor we additionally
  need the Info.plist key and an `await Permissions.request("microphone")`
  on first launch.
- Real-world Capacitor voice-recorder plugins observe enough
  reliability gaps in WebKit that they default to native AVAudioSession
  recording on iOS rather than `MediaRecorder` — outputting `audio/mp4`
  (M4A container) on iOS and `audio/aac` on Android.
  Source: `github.com/independo-gmbh/capacitor-voice-recorder`.

### Implications for Murmur

- The current `HumScreen` mime-type chain
  `webm;codecs=opus → webm → mp4` already includes the iOS path. The
  server worker already handles m4a/mp4 via `pydub`
  (`workers/audio-engine/main.py` `decode_audio`). Web shell is OK.
- For Phase 6 (Capacitor iOS), we should still adopt a native plugin
  fallback because:
  - Some iOS versions report `MediaRecorder.isTypeSupported("audio/mp4") === false`
    spuriously, leaving us with no recorder at all.
  - WKWebView's `getUserMedia` permission prompt has different
    behavior from Safari and can be missed by users (no obvious
    "tap microphone to allow" affordance).
- Recommended path: keep the web-shell `MediaRecorder` flow as the
  primary; behind a `capacitor-voice-recorder` (or similar) detection
  shim, route to native recording in the Capacitor shell. Output
  format converges to `audio/mp4`, which the worker already accepts.

### Repo action

- Patch `docs/cross-platform-strategy.md` §4.1 with explicit
  "Capacitor iOS uses native recorder plugin; web shell uses
  MediaRecorder fallback chain; both ship m4a/mp4 to the worker."
- Add a `log("capture.failed", { error_code: "mp4_unsupported", ... })`
  branch when both webm and mp4 are unsupported, so we can detect the
  bug class in the new `/me/debug` ring buffer if it ever surfaces.
  (Deferred — small, Stop C-class work.)

---

## 4. SwiftF0 + DeepFilterNet stack reality

### Findings

- **SwiftF0** — MIT-licensed, 95,842 parameters, 42× faster than CREPE
  on CPU. Has an ONNX runtime path (incl. the official WASM browser
  demo at `swift-f0.github.io`). The Rust ecosystem already wraps it
  (`pitch-core-onnx`). Active project (last release v0.1.2 in July
  2025).
  Sources: `github.com/lars76/swift-f0`,
  `arxiv.org/html/2508.18440v1`,
  `pypi.org/project/swift-f0/`,
  `docs.rs/pitch-core-onnx/`.
- **DeepFilterNet** — MIT/Apache dual-licensed, real-time-factor 0.19
  on a notebook i5-8250U single-threaded. Pinned in our worker to
  `deepfilternet==0.5.6` + `torch==2.5.1` + `torchaudio==2.5.1`
  because newer torchaudio versions no longer expose the backend path
  DeepFilterNet 0.5.6 imports.
  - Maintenance signal is mixed: last upstream release was v0.5.6
    (Aug 2023), last commit Oct 2024, 49 open issues. Not abandoned,
    but no longer rapidly improving.
  - Container Lambda deployments exist (`duohub-ai/deepfilter-lambda-container`)
    and use AWS Provisioned Concurrency to mask cold start.
  Sources: `github.com/rikorose/deepfilternet`,
  `isca-archive.org/interspeech_2023/schroter23b_interspeech.pdf`,
  `github.com/duohub-ai/deepfilter-lambda-container`.

### Implications for Murmur

- Licensing is clean for both — no GPL contamination, no rev-share, no
  commercial-tier gating. We can ship SwiftF0 + DeepFilterNet inside
  the Murmur worker for any commercial product without negotiation.
- The DeepFilterNet maintenance slowdown is the bigger risk. If
  torchaudio 2.6+ breaks the pinned path, we either freeze our worker
  Docker base image (acceptable for v2, costly for years) or migrate
  to a maintained alternative (RNNoise via the Rust crate ecosystem,
  Krisp SDK if budget allows, or self-trained Demucs-style enhancer).
  None of these need to happen in v2; flagging for v3.
- An **architectural option worth considering for v3**: SwiftF0 has a
  WASM/ONNX browser path. We could run pitch detection in the client
  to lower worker load, and reserve the worker for denoise + polish +
  range-clamp. This would also enable an "offline demo" path for
  Capacitor and the 微信 MP plays back music client-side anyway. Worth
  prototyping after Phase 1 stabilises.

### Repo action

- Patch `docs/audio-pipeline-redesign.md` §4.2 with the maintenance
  risk + freeze-Docker-base mitigation.
- Patch `docs/audio-pipeline-redesign.md` §4.3 with the "SwiftF0 has a
  client-side ONNX/WASM path" note as a v3 architecture option.

---

## 5. 微信小程序 — class / 备案 / 网络文化经营许可证

### Findings

- WeChat MP categories include "音乐、电台、有声读物." Selecting it
  declares the MP as providing **音乐在线播放等服务**, which is a
  pre-approved class requiring **《网络文化经营许可证》** ("网文证")
  from the provincial 文化和旅游厅 before ICP filing is accepted.
  Sources: `developers.weixin.qq.com/miniprogram/product/record/record_review.html`,
  `help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/pre-approvals`,
  `volcengine.com/docs/6428/68735`.
- 网文证 in practice requires the operating entity to be a
  Chinese-domiciled company (not an individual) with paid-in capital
  typically ≥ 1 000 000 RMB, plus dedicated compliance staff and a
  business scope that includes 文化内容. Approval times are 1–3 months.
- ICP 备案 itself is the base requirement for any production-bound MP;
  short-message verification from MIIT (12381) must complete within
  24 h or the filing is rejected.
- Upload API constraints worth knowing for the 备案 step itself:
  images ≤ 2 MB in JPG/JPEG/PNG, videos in MP4. No special audio
  format required at filing time — the MP itself constrains audio
  separately (`wx.getRecorderManager` supports mp3, max ~60 s without
  fragmentation).

### Implications for Murmur

- Choosing the **音乐 / 音乐服务** category locks us into 网文证 with
  the resource implications above. For a v2-grade product without a
  registered Chinese entity, this is a hard blocker.
- A defensible alternative classification: **工具 / 创作辅助** (or
  similar AI-assisted creation tools that produce user-original
  output). The MP would be framed as a "user-original melody arranger"
  rather than a "music streaming service." Whether this classification
  actually clears 微信 review depends on the specific category words
  and the reviewer; this is a legal review item, not an engineering
  one. Lean on a local PRC counsel before submission.
- Even with the alternative classification, ICP 备案 is required.
  We need a registered .cn domain pointed at a server inside mainland
  China (likely 腾讯云 / 阿里云) and an entity that can pass ICP review
  (individual ICP is possible for non-commercial services, but limits
  payment etc.; for a paid product expect to need 企业 ICP).

### Repo action

- Patch `docs/cross-platform-strategy.md` §4.3 to flag the 网文证
  gate explicitly as the China-shell critical path, including the
  "音乐 vs 工具" classification debate that must be settled by counsel
  before submission.
- Patch `docs/payment-topup-feature.md` §9 / "什么时候触发" with the
  ICP + 网文证 dependency for any China-region payment.

---

## 6. RevenueCat + Capacitor — real pitfalls

### Findings

- `Purchases.purchasePackage` / `Purchases.purchaseStoreProduct` /
  `Purchases.getCustomerInfo` can **hang indefinitely** without
  resolving or rejecting the returned Promise. Two common causes:
  1. Frontend framework reactive proxies passed in (Vue's `ref`,
     Svelte 5 proxies). The Capacitor bridge can't serialize them and
     silently drops. RevenueCat's docs prescribe `toRaw()`.
  2. Native side misconfigured: missing API key, missing service
     account JSON on Google Play, products not yet propagated to
     Sandbox / TestFlight.
- Network failure with no cached `CustomerInfo` also hangs on first
  launch — RevenueCat doesn't apply a default timeout.
  Sources: `github.com/RevenueCat/purchases-capacitor/issues/279`,
  `github.com/RevenueCat/purchases-ios/issues/4931`,
  `github.com/RevenueCat/purchases-capacitor/issues/282`,
  `community.revenuecat.com/sdks-51/purchases-configure-return-1-on-capacitor-android-7367`.

### Implications for Murmur

- We use Zustand (no reactive proxies wrapping plain objects), so the
  `toRaw()` class of bug is unlikely to bite us directly. We should
  still defend against future-us by passing SKU objects through a
  `structuredClone(...)` before handing them to `Purchases.*`.
- The "promise never resolves" class **will** bite us during cold
  starts on slow networks. Every RevenueCat call must be wrapped in a
  timeout (`Promise.race([call, sleep(8000).then(() => throw)])`) so
  the Checkout state machine can surface a `provider_timeout` error
  and offer a retry.
- Apple StoreKit 2 (default in RevenueCat 5.0+) sandbox testing
  through Capacitor on simulator requires a `storekitconfig.storekit`
  file in Xcode; we should bundle one in the Capacitor scaffold from
  the start.

### Repo action

- Patch `docs/payment-topup-feature.md` §6 / Capacitor section with
  the timeout-wrapper requirement and the `structuredClone` guard,
  citing the specific GitHub issues.
- Add a `BillingError("provider_timeout")` row to the future
  `apps/web/src/lib/api/errors.ts` (already planned in standards §3;
  preserved here for traceability).

---

## 7. Object storage — `mp3DataUrl` is a now-problem, not a later-problem

### Findings

- Cloudflare R2: **$0.015/GB stored, $0 egress**, 10 GB free tier,
  S3-compatible API.
- AWS S3 Standard: $0.023/GB stored, $0.09/GB egress for the first
  10 TB.
- Real-world math at v2-realistic scale (1 TB stored + 10 TB/month
  egress): R2 = $15 / mo, S3 = $914 / mo.
- Vercel Blob is built on R2 but adds markup (~$0.15/GB egress after
  the included allowance), so it loses the egress advantage for any
  scale where streaming dominates.
- 中国大陆: 腾讯云 COS / 阿里云 OSS price-structure is closer to S3
  (egress is billed). R2 is not directly usable in China without a
  CDN like CloudFront-equivalent — for the China region we plan to
  use 腾讯云 COS anyway per `cross-platform-strategy.md`.
  Sources: `klymentiev.com/blog/r2-vs-s3`,
  `cloudflare.com/pg-cloudflare-r2-vs-aws-s3`,
  `agentdeals.dev/storage-comparison-2026`,
  `adamarant.com/en/blog/cloudflare-r2-vs-s3-vs-supabase-storage-in-2026-which-to-pick`.

### Implications for Murmur

- Today's `songs.mp3DataUrl` (base64 audio inside a Postgres TEXT
  column) is a **latent production bug**, not a v3 cleanup:
  - 100 users × 10 songs × 200 KB ≈ 200 MB of Postgres BLOB.
    Postgres backups, replication lag, and `pg_dump` size all scale
    poorly with this.
  - Reading a 200 KB column for every gallery card render is wasted
    bandwidth from the DB tier (the most expensive byte we move).
  - Mobile shells will read mp3s often (the user replays their own
    songs) and Postgres-to-client streaming is the wrong tier for
    that traffic.
- Moving this to object storage **before** Phase 6 (Capacitor) is
  almost required. By the time we have iOS users, every cold-start
  hits the gallery hard.
- Vendor pick: **R2 for international, 腾讯云 COS for China**. Both
  S3-compatible enough to share a single `objectStore.put(...)`
  adapter behind a feature flag for region.

### Repo action

- Patch `docs/data-model.md` §3.3 (object storage section) to
  promote `mp3DataUrl` removal from "v2 mid-cycle" to "must precede
  Phase 6," with the R2 + 腾讯云 COS vendor pick documented.
- Schedule the `POST /api/songs/upload-token` route (already in
  `docs/api-conventions.md` §6.2) for Phase 4 in
  `docs/execution-roadmap.md` so it lands with the rest of billing /
  storage rather than alongside Capacitor work.
- Add a `DEPRECATIONS.md` row for `songs.mp3DataUrl` writes — already
  present in standards §9; no new entry needed, just verify.

---

## 8. Music copyright + content moderation climate

### Findings

- The 2024 majors-vs-AI lawsuits (UMG, Sony, Warner vs Suno and Udio)
  are partially settled:
  - **Udio** settled with UMG in October 2025 and **disabled public
    song downloads** in favor of an "interactive walled garden."
    Sony has expanded its complaint to 30,000+ recordings; Udio's
    fair-use defense is precarious.
  - **Suno** has a Warner deal but retains download functionality
    with monthly caps. Free-tier tracks have **no commercial
    rights**, retroactively.
  - A new entrant, **Klay Vision**, is fully licensed from Sony,
    UMG, Warner, Merlin, and Kobalt as the labels' preferred model.
  Sources: `weraveyou.com/2026/05/suno-udio-umg-copyright-lawsuit-musicians-2026/`,
  `musicbusinessworldwide.com/sony-music-moves-to-add-more-than-30000-copyrighted-recordings-to-its-lawsuit-against-udio/`,
  `undetectr.com/blog/suno-udio-licensing-deals-explained`.

- Direct competitor positioning:
  - **Boomy** — all-in-one (generation + distribution) but takes
    20% of streaming royalties.
  - **Suno Pro** — $10/mo, 500 credits, commercial rights included on
    paid plans.
  - **Mureka** — the closest analog to Murmur. Has explicit
    hum-to-song input ("Melody Idea") which Suno and Udio do **not**
    offer. Adds stems + MIDI export.

- Consumer-app retention benchmarks (2026, mobile, average):
  Day 1 25–30 %, Day 7 10–15 %, Day 30 5–7 %. Music creation apps
  that bridge AI generation into professional workflows (stems, MIDI,
  collaboration) sustain meaningfully higher engagement than
  generation-only tools.
  Sources: `enable3.io/blog/app-retention-benchmarks-2025`,
  `retention.blog/p/simply-app-empire-part-2`,
  `productpotion.com/p/spotifys-100b-brain-trick-and-the-dopamine-loop-your-product-is-skipping`,
  `musci.io/blog/mureka-review`.

### Implications for Murmur

- **Murmur's legal posture is defensibly stronger than Suno/Udio's**:
  the model input is the user's own humming, not a prompt that
  invokes a trained-on-copyrighted-music distribution. We are an
  arrangement tool over user-original melody, not a text-to-song
  generator. Provided we (a) do not train on copyrighted recordings,
  (b) provide clear "AI-assisted, user-original" attribution, and
  (c) do not encourage prompt patterns that mimic specific artists,
  the most aggressive lawsuit theory does not reach us.

- **Competitive niche is real**: Mureka validates that hum-to-song is
  a paid niche underserved by the prompt-generation incumbents. Our
  v2 plan (Hum → Vibe → Studio → Save) is the right product. The
  retention work will be in onboarding (magic demo before paywall),
  multi-take encouragement, and a follow-up loop in the first 48 h.

- **First-run UX**: the research consistently flags "never show the
  user an empty dashboard" as a top-3 retention lever. Our
  `GalleryScreen` empty state today says "还没有小歌." The
  Spotify/Simply pattern is to pre-fill with a seeded demo song so
  the user sees the gallery doing something on first load. This is
  a v2.5 polish item, not a v2 blocker, but worth a tracked TODO.

- **China-region content review**: even with the 工具 / 创作辅助
  classification, MP review will check the output for copyright
  resemblance. We should retain a takedown / report path from the
  start for both web and MP, even though the current product surface
  doesn't have user-facing sharing yet.

### Repo action

- Patch `docs/cross-platform-strategy.md` §10 with the legal posture
  paragraph (we are arrangement-over-user-melody, not prompt-to-song)
  so any future doc reader understands why we don't need an upfront
  major-label license.
- Add to `docs/phase-plans/phase-1-hum-surface.md` Stop F: "GalleryScreen
  seeded-demo empty state."

---

## 9. Cross-cutting summary — what changed about the roadmap

After this research pass, three roadmap edits are warranted; this PR
patches the relevant docs:

1. **Phase 5 (carve `packages/murmur-core`) is now also "carve the
   API surface"** — not just shared TS modules. Without a
   remote-deployable API host, Capacitor and 微信 MP can't talk to
   anything. Practically: the API must be deployable as a standalone
   Next.js app (or an extracted node service) before Phase 6 starts.

2. **Phase 4 (payment + storage) absorbs the `mp3DataUrl` migration.**
   It was previously listed as a Phase-4 "watch item"; the storage
   math says it must ship *with* billing, not after.

3. **Phase 6 (Capacitor) acquires a hard prerequisite list**: APNs
   push, Sign in with Apple, native share, native voice recorder
   plugin, in-app browser plugin, `apiBaseUrl()` config, RevenueCat
   timeout-wrapped. This is the 4.2-passing minimum, not a stretch
   set. Estimate moves from "3–4 weeks" to "4–6 weeks" once the
   review-cycle latency is honest.

## 10. Out of scope

- Vendor-specific deal terms (Sentry tier price, RevenueCat tier
  price). Track in commercial planning, not engineering.
- WeChat MP voice plugin compatibility matrix beyond the 备案 gate.
  Phase 7 will rediscover the API specifics; engineering plan only
  needs the 备案 work-stream right now.
- Apple Search Ads, ASO, conversion rate benchmarks. Marketing scope.

Sibling docs: `cross-platform-strategy.md`, `audio-pipeline-redesign.md`,
`payment-topup-feature.md`, `data-model.md`, `api-conventions.md`,
`execution-roadmap.md`.
