# Page Contracts

The product is the set of pages. This document fixes — for every page —
**what state it owns, what state it reads, what API it calls (with JSON
shapes), what user actions it tracks, and what "done" means for that
page**. It is the contract any UI implementation must satisfy, regardless
of which shell (Web, Capacitor, 微信 MP) ships it.

When a downstream agent builds a screen, the screen is correct iff this
contract is satisfied. Pixel placement is design's call (see
`studio-compose-redesign.md` for Studio); the data flow is here.

## 0. Conventions used in this doc

- **`OwnedState`** — state the page can mutate. Lives in the client store
  for now (`src/lib/store/murmur-store.ts`); will migrate to per-page
  stores when complexity warrants.
- **`ReadState`** — state the page reads but does not write.
- **`APIs called`** — every endpoint, with request + response shape. All
  shapes match `docs/api-conventions.md`.
- **`Actions`** — every distinct user input that mutates state or
  triggers an API call. Each one must emit a `memory.reportAction`
  event with the metadata listed.
- **`Done`** — the page is "feature-complete v2" when each row is true.
- **`Out of scope`** — explicit non-goals. Helps Codex stop instead of
  inventing.

The pages, in user-flow order: Hum → Vibe (VersionCards) → Studio →
Name → Gallery → SongDetail → Me → Topup → Checkout. New pages are
marked **NEW**.

---

## 1. Hum (`/`)

[src/components/screens/HumScreen.tsx](/Users/dujiayi/murmur/src/components/screens/HumScreen.tsx)

### OwnedState

```ts
type HumScreenState = {
  recordingState: "idle" | "recording" | "processing" | "done" | "error";
  recordingTime: number;     // seconds elapsed, capped at MAX_DURATION (15)
  amplitude: number;         // 0–1, RMS reactive level meter (driven by AnalyserNode)
  idleHeadlineIndex: number; // rotates through 5 idle copy strings
  processingMessage: string; // the rotating "listening / polishing / …" copy
  micFailed: boolean;        // permission denied OR capture cannot start
  transcribeError: TranscribeErrorCode | null;  // typed user-facing failure family
};

type TranscribeErrorCode =
  | "no_voiced_frames"  // we tried — there's no usable pitch in the audio
  | "too_short"         // audio < 1.5s
  | "format_unsupported"
  | "rate_limited"      // 429
  | "insufficient_notes" // 402
  | "server_error";     // any 5xx
```

### ReadState

- `useMurmurStore.vibeVersions` — to clear before a new run.
- `useTranslator()` — i18n.
- `useUserBalance()` — NEW hook reading `/api/user/balance`, returned in
  the Hum surface so the user sees "1 note" before they record.

### APIs called

- `POST /api/transcribe`
  - Request (multipart):
    ```
    audio:            File (audio/webm | audio/m4a | audio/mp3 | audio/wav)
    targetInstrument: "piano" | "bell" | "guitar" | "marimba" | "synth_lead"
    ```
  - 200 response:
    ```ts
    type ScoredMelodyResponse = {
      provider: "swiftf0" | "pyin" | "fixture";
      rawNotes: MelodyNote[];
      cleanMelody: CleanMelody;
      warnings: string[];
      diagnostics: {
        duration: number;
        snr: number;
        voicedRatio: number;
        denoiseMs: number;
        pitchMs: number;
      };
    };
    ```
  - 402: `{ error: "insufficient_notes", currentBalance: number }`
  - 422: `{ error: TranscribeErrorCode, message: string }`

### Actions

| Action | Trigger | Result | `memory.reportAction` metadata |
|---|---|---|---|
| `start_recording` | pointerDown on orb (idle, mic granted) | flips to `recording`, starts timer + analyser RAF | `{ type: "hum_start" }` |
| `stop_recording` | pointerUp / pointerLeave / 15 s elapsed | stops MediaRecorder, transitions to `processing`, calls `/api/transcribe` | `{ type: "hum_stop", duration }` |
| `try_demo_melody` | click on **Try a demo melody** | bypasses `/api/transcribe`, runs local fixture | `{ type: "hum_demo" }` |
| `retry_after_error` | click "Try again" on error surface | resets state to idle | `{ type: "hum_retry", error_code }` |
| `mic_permission_denied` | `getUserMedia` rejection | `micFailed = true` | `{ type: "mic_denied" }` |
| `transcribe_success` | 200 from API | `setVibeVersions(generateVibeVersions(cleanMelody))`, navigate to VersionCards | `{ type: "hum_transcribe", provider, bpm, key, notes }` |
| `transcribe_error` | 402 / 422 / 5xx | show error surface with `transcribeError` code | `{ type: "hum_error", code }` |
| `fixture_rescue_auto` | first isolated transient failure after known-good live use | auto-run fixture to save the session, while still logging the failure | `{ type: "hum_fixture_rescue", code, request_id }` |

### Done

- [ ] No broad silent fixture masking. Automatic fixture rescue is allowed only
      for a narrow transient-failure bucket after known-good live success, and
      must stop after repeated failures.
- [ ] 402 / 422 / 5xx each surface a distinct copy line; user can retry
      or "Try a demo" from each.
- [ ] Level meter shows usable signal during recording (driven by
      AnalyserNode, not cosmetic).
- [ ] Mic permission denial surfaces a clear path: "use demo," "try
      again," or "settings link" (iOS / Android shell).
- [ ] Support code only appears for persistent / hard failures, not the first
      product-handled transient blip.
      Current rule: show it immediately for hard backend faults, but hide it
      for the first post-success transient failure and only surface it once the
      issue looks persistent or the session never reached a healthy live hum.
- [ ] Automatic fixture rescue stays in the "save the moment, not hide the
      outage" lane:
      only after at least one live success, never for fundamental audio errors,
      never on cold-start failures, and it stops once transient failures repeat
      closely enough to look like a sustained outage.
- [ ] `transcribe_success` dispatches `setVibeVersions` AND navigates
      via `router.push("/vibe")` (today it relies on Vibe being a sibling
      overlay; v2 makes Vibe its own route).

### Out of scope

- Visualizing the raw waveform.
- Editing the recording before transcription.
- Anything multi-take. v2 is one hum at a time.

---

## 2. Vibe / VersionCards (`/vibe`)

Currently rendered as overlay
[VersionCardsOverlay.tsx](/Users/dujiayi/murmur/src/components/screens/VersionCardsOverlay.tsx).
v2: promote to its own route so back / forward / share / refresh all work.

### OwnedState

```ts
type VibeScreenState = {
  auditioningVersionId: string | null; // which card is audibly playing
  pickedVersionId: string | null;      // committed pick, before transitioning
};
```

### ReadState

- `useMurmurStore.vibeVersions: VibeVersion[]` — exactly 3 items.

### APIs called

None. Vibe is a pure presentational + audition page; arrangement is
local.

### Actions

| Action | Trigger | Result | metadata |
|---|---|---|---|
| `audition_version` | tap on a card | starts SimpleSynth preview for `version.id` | `{ type: "vibe_audition", version_id, vibe }` |
| `stop_audition` | tap on auditioning card again | stops synth | `{ type: "vibe_audition_stop" }` |
| `pick_version` | tap "Pick" / commit gesture | `setCurrentVersion(picked)`, navigate to `/studio` | `{ type: "vibe_pick", version_id, vibe }` |
| `regenerate` | "Try again" button (NEW) | re-runs `generateVibeVersions(melody)` with new seed | `{ type: "vibe_regenerate" }` |

### Done

- [ ] Lives at its own route `/vibe`, hard-refresh restores the 3 cards
      from store (or redirects to Hum if no melody).
- [ ] Press-and-hold preview behavior matches Compose v2 (see
      `studio-compose-redesign.md`).
- [ ] Regenerate is **free** (no notes spent — arrangement is local).
- [ ] Loss of `vibeVersions` (refresh after data is gone) → redirect to
      `/` with a toast.

### Out of scope

- Manual key / BPM override on this page.
- Mixing two versions.

---

## 3. Studio / Compose (`/studio`)

Spec is in [studio-compose-redesign.md](studio-compose-redesign.md).
This entry only states the data contract.

### OwnedState

```ts
type ComposeScreenState = {
  plane: 1 | 2 | 3;             // Listen | Tweak | Balance
  isPlaying: boolean;
  promptBusy: boolean;
  composeUndoStack: ArrangementState[];  // ring buffer, max 10
  llmReason?: string;           // last LLM "why we picked these tokens"
};
```

### ReadState

- `useMurmurStore.currentVersion: VibeVersion | null` — required;
  redirect to `/` if null.

### APIs called

- `POST /api/strummer/edit` — LLM edit classification.
  - Request: `{ prompt: string }`
  - 200: `{ tokens: EditToken[], reason?: string }`
  - 402 / 5xx: same envelope as `/api/transcribe`.

(Save flow leaves to `/studio/name` route; that's a separate page.)

### Actions

| Action | Trigger | Result | metadata |
|---|---|---|---|
| `play` | hero tap | starts SimpleSynth | `{ type: "compose_play", version_id }` |
| `pause` | hero tap | stops | `{ type: "compose_pause" }` |
| `scene_apply` | tap on a scene card | `applyEdit(state, tokens[])` push to undo | `{ type: "scene_apply", scene_id, tokens }` |
| `scene_preview` | press-and-hold | applies scene to a temp state for audition | `{ type: "scene_preview", scene_id }` |
| `auris_submit` | enter or click on Auris input | rule parser → LLM fallback → `applyEdit` | `{ type: "auris_submit", prompt, tokens }` |
| `undo` | undo pill | pops from `composeUndoStack` | `{ type: "compose_undo" }` |
| `restore_all` | restore pill | applies `restore_all` token, clears undo | `{ type: "compose_restore" }` |
| `fine_tune_open` | "Fine-tune" link | plane → 3 | `{ type: "fine_tune_open" }` |
| `track_change` | mixer slider / toggle | `updateTrack` patch | `{ type: "track_change", track, field }` |
| `tweak_back` | back gesture / arrow | plane → 1 | `{ type: "tweak_back" }` |
| `save_proceed` | save CTA | navigate `/studio/name` (only if balance ≥ 1; else gated) | `{ type: "save_proceed" }` |

### Done

- [ ] All acceptance items from `studio-compose-redesign.md` §12.
- [ ] Save CTA gates on `useUserBalance() >= 1`; otherwise shows
      "Save (need 1 note) — Top up" → links to `/topup`.
- [ ] LLM reason surfaces as a one-line toast under the Auris input on
      success.

### Out of scope

- Multi-version A/B compare.
- Lyrics overlay.
- Inline title edit (lives on `/studio/name`).

---

## 4. Name (`/studio/name`)

[NameScreen.tsx](/Users/dujiayi/murmur/src/components/screens/NameScreen.tsx).
Final save step.

### OwnedState

```ts
type NameScreenState = {
  title: string;             // user-edited or generated default
  saveBusy: boolean;
  saveError: string | null;
};
```

### ReadState

- `useMurmurStore.currentVersion` — must exist.

### APIs called

- `POST /api/songs`
  - Request:
    ```ts
    {
      title: string;
      vibe: string;
      vibeEn: string;
      bpm: number;
      keySignature: string;
      scaleType: "major" | "minor" | "pentatonic" | "dorian" | "phrygian";
      duration: number;
      mp3Url: string;            // CHANGED: object-storage URL, not data URL
      visualConfig: VisualConfig;
      arrangementState: ArrangementState;
      tags: string[];
      melody: CleanMelody;       // NEW: durable melody so SongDetail can replay correctly
    }
    ```
  - 201: `Song` row.
  - 402: insufficient notes.

- Companion call before the POST:
  - `POST /api/songs/upload-token` — get a presigned URL for the MP3
    render (see `data-model.md` §3.3 and `api-conventions.md` §6).

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `name_open` | mount | `{ type: "name_open", vibe }` |
| `title_edit` | input change | `{ type: "title_edit" }` (debounced) |
| `save_commit` | save tap | render MP3 client-side → upload → POST song | `{ type: "name_save_commit", title }` |
| `save_error` | non-2xx | show retry surface | `{ type: "name_save_error", code }` |
| `save_success` | 201 | navigate `/song/[id]` | `{ type: "name_save_success", song_id }` |

### Done

- [ ] No more base64 MP3 storage. MP3 → object storage; DB stores URL.
- [ ] Save is atomic with notes-ledger debit (server transaction).
- [ ] On save success, user lands in SongDetail and never in Studio again
      (back from SongDetail goes to Gallery).
- [ ] If the MP3 render fails the song still saves with `mp3Url = null`;
      user sees a soft warning.

### Out of scope

- Album / playlist concept.
- Cover image upload.

---

## 5. Gallery (`/gallery`)

[GalleryScreen.tsx](/Users/dujiayi/murmur/src/components/screens/GalleryScreen.tsx).
UI is OK today; v2 work is data hygiene + delete affordance.

### OwnedState

```ts
type GalleryScreenState = {
  isLoading: boolean;
  selectedSongId: string | null; // for long-press / right-click → delete
};
```

### ReadState

- `useMurmurStore.songs`.

### APIs called

- `GET /api/songs?limit=50&cursor?` — paginated (NEW; today the route
  returns everything).
- `DELETE /api/songs/[id]` — delete a song.

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `gallery_open` | mount | `{ type: "gallery_open", count }` |
| `gallery_open_song` | tap card | navigate `/song/[id]` | `{ type: "gallery_open_song", song_id }` |
| `gallery_delete_request` | long-press / right-click | show confirm | `{ type: "gallery_delete_request", song_id }` |
| `gallery_delete_confirm` | confirm in modal | DELETE /api/songs/[id] | `{ type: "gallery_delete_confirm", song_id }` |
| `gallery_new_hum` | empty state CTA | navigate `/` | `{ type: "gallery_new_hum" }` |

### Done

- [ ] Pagination works (50 per page; "Load more" or auto-paginated).
- [ ] Delete with confirm modal works; optimistic update.
- [ ] Empty state copy distinguishes new user vs. all-deleted.

### Out of scope

- Search / filter (v3).
- Tagging UI (v3).

---

## 6. SongDetail (`/song/[id]`)

[SongDetailScreen.tsx](/Users/dujiayi/murmur/src/components/screens/SongDetailScreen.tsx).
Today's pause-and-play has a real bug: fallback reconstructs melody from
`arrangementState.melody.currentPattern.split(" ").map(Number)` — that
loses BPM and rhythm. v2 stores the original `CleanMelody` in the DB so
playback fidelity is preserved (see `data-model.md`).

### OwnedState

```ts
type SongDetailScreenState = {
  isLoading: boolean;
  isPlaying: boolean;
  song: Song | null;            // see data-model.md §3.1
  exportBusy: "audio" | "html" | "poster" | "webm" | null;
};
```

### APIs called

- `GET /api/songs/[id]`
- `POST /api/songs/[id]/export?format=webm|audio|html|poster` (NEW
  server-side render endpoint; replaces the client-side WebM render that
  hangs the main thread for big songs).
- `DELETE /api/songs/[id]` — moved here from Gallery overflow.

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `song_open` | mount | `{ type: "song_open", song_id }` |
| `song_play` | tap | start audio (`mp3Url` preferred; fallback to client synth using `song.melody + song.arrangementState`) | `{ type: "song_play", song_id }` |
| `song_pause` | tap | pause | `{ type: "song_pause" }` |
| `song_to_studio` | sliders icon | navigate `/studio` with `setCurrentVersion(songToVersion(song))` | `{ type: "song_to_studio", song_id }` |
| `song_export` | export pill | POST export endpoint | `{ type: "song_export", song_id, format }` |
| `song_delete` | overflow → delete | DELETE | `{ type: "song_delete", song_id }` |
| `song_share` | share icon (Capacitor / Web Share API) | system sheet | `{ type: "song_share", song_id }` |

### Done

- [ ] Fallback playback uses `song.melody` (the saved `CleanMelody`),
      NOT a string-split of `currentPattern`. Same arrangement engine
      runs in playback as ran at save time.
- [ ] Export endpoints respect notes balance:
      - audio: 0 notes (re-serve cached `mp3Url`)
      - html: 0 notes (client renders)
      - poster: 0 notes (client renders)
      - webm: 2 notes (server render)
- [ ] "Sliders" icon opens Studio in **edit mode** with restoration
      behavior — leaving Studio without saving does not corrupt the
      saved song.
- [ ] Share uses native share sheet on Capacitor; falls back to
      `navigator.share` then a copy-to-clipboard with toast.

### Out of scope

- Inline lyrics editing.
- Versions / revisions per song.
- Comments / social.

---

## 7. Me (`/me`)

[MeScreen.tsx](/Users/dujiayi/murmur/src/components/screens/MeScreen.tsx).
Today this page exposes runtime debug strings to end users; v2 cleans
that up and adds the balance + plan surfaces.

### OwnedState

None beyond `useState` for transient UI.

### ReadState

- `useMurmurStore.songs.length`
- `useUserBalance()`
- `useCurrentUser()` — NEW hook from auth provider.

### APIs called

- `GET /api/user/profile` — display name, email, avatar.
- `PATCH /api/user/profile` — edit name (avatar via provider OAuth).
- `POST /api/auth/logout` — NEW.

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `me_open` | mount | `{ type: "me_open" }` |
| `me_lang_change` | tap zh / en | `{ type: "me_lang_change", lang }` |
| `me_topup_open` | "Top up" tap | navigate `/topup` | `{ type: "me_topup_open" }` |
| `me_sign_in` | guest → "Sign in" | provider sheet | `{ type: "me_sign_in_intent" }` |
| `me_logout` | confirm logout | call API + redirect `/` | `{ type: "me_logout" }` |
| `me_delete_account` | settings sheet | confirm + DELETE /api/user/account | `{ type: "me_delete_account" }` |
| `me_change_email` | tap | guarded by re-auth | `{ type: "me_change_email" }` |

### Done

- [ ] Runtime debug strings removed from the default Me surface. Move
      to a `/me/debug` route gated by `?debug=1` for power users.
- [ ] Balance, plan tier ("Free" / "Premium" — premium is reserved),
      and "Top up" CTA visible.
- [ ] If guest, surface a "Sign in to keep your songs" CTA prominently.
- [ ] Delete-account flow works (and zeroes the ledger, see
      `data-model.md` §3.4).

### Out of scope

- Notifications preferences UI (notifications publisher is a stub).
- Connected accounts (e.g. linking WeChat to Apple).

---

## 8. Topup (`/topup`) — **NEW**

Specced in [payment-topup-feature.md](payment-topup-feature.md) §5.1.

### OwnedState

```ts
type TopupScreenState = {
  isLoading: boolean;
  selectedSku: string | null;
  skus: Sku[];
};

type Sku = {
  id: string;             // "topup_30_notes"
  notes: number;          // 30
  priceCents: number;     // 199
  currency: "USD" | "CNY";
  display: string;        // "$1.99" or "¥12"
  highlight?: "popular" | "best_value";
};
```

### ReadState

- `useUserBalance()`
- `useCurrentUser().regionId` — drives which SKU price card shows.

### APIs called

- `GET /api/billing/skus` — returns the price card for the user's region
  AND provider (web / iOS / android / wechat-mp).

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `topup_open` | mount | `{ type: "topup_open", balance }` |
| `topup_sku_select` | tap a SKU | `{ type: "topup_sku_select", sku }` |
| `topup_proceed` | "Buy notes" | navigate `/topup/checkout?sku=<id>` | `{ type: "topup_proceed", sku }` |
| `topup_restore` | "Restore purchases" (iOS / Android only) | RevenueCat restore call | `{ type: "topup_restore" }` |

### Done

- [ ] Three SKUs displayed in bento layout with highlight badges.
- [ ] Current balance always visible at top.
- [ ] Daily-refill caption shows local time of next refill.
- [ ] Restore button visible only on Capacitor shells.

### Out of scope

- Coupon UI.
- Gift purchasing.

---

## 9. Checkout (`/topup/checkout`) — **NEW**

The provider-handoff page. Specced in
[payment-topup-feature.md](payment-topup-feature.md) §5.2.

### OwnedState

```ts
type CheckoutScreenState = {
  status: "idle" | "requesting" | "succeeded" | "canceled" | "failed";
  errorMessage: string | null;
  sku: Sku;
  provider: "stripe" | "wechat_pay" | "apple_iap" | "google_play";
};
```

### ReadState

- Hydrates `sku` from the URL param `?sku=<id>` against the SKU table
  from `/api/billing/skus`.

### APIs called

By provider:

- **Stripe (web intl)** — `POST /api/billing/checkout` →
  `{ checkoutUrl }`; client `window.location = checkoutUrl`. Webhook
  handles the ledger.
- **WeChat Pay (web cn)** — `POST /api/billing/wechat-prepay` →
  `{ jsapi: { appId, timestamp, nonceStr, package, signType, paySign } }`;
  client opens WeChat MWEB.
- **Apple IAP (iOS Capacitor)** — RevenueCat SDK; backend listens to
  the RevenueCat webhook.
- **Google Play (Android Capacitor)** — same RevenueCat path.
- **WeChat MP** — `wx.requestPayment({...})` directly.

All providers eventually emit:

- `POST /api/billing/webhook/<provider>` → ledger row + balance update.

The client just polls `GET /api/user/balance` once after the provider
returns success.

### Actions

| Action | Trigger | metadata |
|---|---|---|
| `checkout_open` | mount | `{ type: "checkout_open", sku, provider }` |
| `checkout_provider_invoke` | mount completion | `{ type: "checkout_invoke", provider }` |
| `checkout_success` | provider returns succeeded | `{ type: "checkout_success", sku, ext_ref }` |
| `checkout_canceled` | user dismissed | `{ type: "checkout_canceled" }` |
| `checkout_failed` | provider error | `{ type: "checkout_failed", code }` |

### Done

- [ ] All four provider paths land here as the unified UI; the state
      machine drives the visible state.
- [ ] On success the user lands back in `/` (Hum) or `/me` with a
      toast "X notes added."
- [ ] On failure, "Try again" returns to `/topup/checkout?sku=<id>`;
      "Use a different method" returns to `/topup`.
- [ ] The page renders correctly on a hard refresh with `?sku=` only.

### Out of scope

- Pre-authorization / hold flows.
- 3DS UI (Stripe handles).

---

## 10. Routes summary

| Path | Page | Shell access |
|---|---|---|
| `/` | Hum | all |
| `/vibe` | Vibe / VersionCards | all |
| `/studio` | Compose | all (MP in v2.5) |
| `/studio/name` | Name (save) | all |
| `/gallery` | Gallery | all |
| `/song/[id]` | SongDetail | all |
| `/me` | Profile | all |
| `/me/debug` | Debug overlay | hidden, all |
| `/topup` | NEW Topup | all |
| `/topup/checkout` | NEW Checkout | all |
| `/api/*` | server only | server |

The Capacitor and Taro shells map these paths to their respective
navigators. Routes are the contract; navigation is the shell's job.

---

## 11. Shared hooks the contract assumes exist

Codex must implement these and surface them in `src/lib/hooks/` (or
inside `packages/murmur-core/hooks/` once the carve is complete).

| Hook | Returns | Notes |
|---|---|---|
| `useCurrentUser()` | `{ id, email, name, regionId, planTier } \| null` | reads session; `null` if guest |
| `useUserBalance()` | `{ notes, nextRefillAt, refresh() }` | SWR-style, caches 30 s |
| `useTranscribeError()` | `(code) => string` | maps `TranscribeErrorCode` → i18n string |
| `useSkus()` | `Sku[]` | hits `/api/billing/skus` once per session |
| `useSongMutation()` | `{ delete, share }` | wraps delete + share for SongDetail / Gallery |

Implementing these in advance keeps page code thin and easy to port to
Capacitor / Taro.

---

## 12. What this contract guarantees

When every page above passes its Done list, the product satisfies:

- Every user action is traceable through `memory.reportAction` events.
- Every API call has a typed shape and an error envelope.
- No page silently degrades — failures are user-visible.
- Every page can be rebuilt for a new shell by re-implementing the UI;
  the data flow is portable.

When a page is unclear, the conflict resolves in this order:
**page-contracts (this file) > sibling v2 docs > v1 docs > the existing
implementation.**
