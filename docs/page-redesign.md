# Page Redesign — Journey + Per-Page UX

The companion to `docs/design-language.md`. The language doc says "what
Murmur looks like." This doc says "what Murmur feels like, page by
page." Read with `docs/page-contracts.md` open in the next tab — the
contracts are the data; this is the experience.

The premise: Hum works. Everything else is being rebuilt to match. We
respect Hum's atmosphere, hierarchy, and restraint, and we carry them
into seven more screens.

---

## 1. The journey as a 9-step emotional arc

A first-time user opens Murmur with a melody stuck in their head. The
journey is **not** "create → save → share." It's a slower, more
human progression:

| # | Screen | Emotional verb | What the user feels |
|---|---|---|---|
| 1 | **Hum** `/` | *capture* | "I have something. Let me put it down before I forget." |
| 2 | *(transition)* | *trust* | "It heard me. Something is happening." |
| 3 | **Vibe** `/vibe` | *discover* | "Look what my hum could become — three different songs?" |
| 4 | **Studio** `/studio` | *author* | "Now make it mine." |
| 5 | **Name** `/studio/name` | *christen* | "What do I call this thing?" |
| 6 | **SongDetail** `/song/[id]` | *possess* | "It's done. It's mine. I can play it again." |
| 7 | **Gallery** `/gallery` | *remember* | "All my little songs in one place." |
| 8 | **Me** `/me` | *reflect* | "This is who I am here." |
| 9 | **Topup → Checkout** `/topup` | *renew* | "More of this." |

Two non-verbs that matter:

- **Atmosphere is continuous.** The aurora drifts under every page.
  The user feels the same cream surface and same warm glow whether
  they're recording, picking, naming, or browsing. The mood does not
  reset.
- **Each screen has one decisive thing.** If you can't say in one
  sentence what the screen wants from the user, it's not done.

### The handoff motion vocabulary

| Edge | Motion idiom |
|---|---|
| Hum → Vibe (post-transcribe) | Iris-close + rainbow ring + iris-open. The product's signature. **Only this edge** uses it. |
| Vibe → Studio (pick a card) | Card scales 0.95, white pulse expands from its center, page swaps with rise-in. ~500 ms. |
| Studio → Name | Slow upward slide (300 ms `mymind`). Studio fades, Name's headline rises in. |
| Name → SongDetail | The user's typed title morphs into the SongDetail hero title. Same string, same x position; only the size and gradient change. ~600 ms. |
| any → Gallery | Cross-fade with hero-zoom on the destination headline. |
| any → Me | Cross-fade. Me's manifesto block fades in slowest. |
| any → Topup | Slide-up sheet on mobile; modal-style overlay on desktop. |

Motion is meaningful; the same edge always uses the same idiom. Two
users never see two different transitions between the same two pages.

---

## 2. Hum `/` — *capture*

**Status: leave as-is.** This is the anchor. Two small additions
required by contracts in `docs/page-contracts.md` §1:

- **Try a demo melody** affordance, visually distinct from the white
  orb. Inline tertiary link below the orb on mobile, in the bottom-bar
  CTA slot on desktop. Copy: `*Or — try a demo melody*` (serif italic,
  underline-mm hover). It bypasses transcribe and routes to fixture.
- **Error states** for `no_voiced_frames`, `rate_limited`,
  `insufficient_notes`, `server_error`. Each surfaces as the same
  quiet `.mm-card` already used for `mic-failed`, with editorial copy:
  - `no_voiced_frames`: *"We listened — but didn't hear a melody.
    Try humming again, a little louder."* + Try again + Try a demo.
  - `rate_limited`: *"Take a small breath. Murmur is catching up."* +
    Try again in `<retryAfterSeconds>` s (countdown).
  - `insufficient_notes`: *"You've used today's free notes. Top up
    or come back tomorrow."* + Top up (coral) + Come back tomorrow
    (ghost).
  - `server_error`: *"Something tripped on our end."* + Try again +
    Use a demo.

Everything else about Hum stays.

---

## 3. Vibe `/vibe` — *discover*

**Current state:** an overlay inside Hum (VersionCardsOverlay). Wave
clip-paths + bento grid + particle dots. Already MyMind-leaning, but
busier than it needs to be.

**Redesign intent:** turn discovery into the editorial cover-spread
moment. The vibe gradients are the art; the UI gets out of the way.

### Promote to its own route

- Move from overlay to `/vibe`. Hard refresh recovers state from the
  store; missing → redirect to `/`.
- Keep the iris-close + rainbow ring + iris-open as the **arrival**
  animation. (We're keeping the magic.)

### Layout

Two layouts, same shape:

**Mobile (single column, vertical stack):**

```
┌────────────────────────────────────────┐
│ [pad-top safe-area]                    │
│ eyebrow: THREE WAYS                    │
│ hero-serif headline                    │
│   "Pick the one your hum is asking     │
│    to become."                         │
│ caption: long-press to preview,        │
│          tap to commit                 │
│                                        │
│ ┌──────────────────────────────┐       │
│ │ Vibe card 1  (3:2)           │       │
│ │   gradient surface            │       │
│ │   serif italic title          │       │
│ │   2-word tag                  │       │
│ │   ▷ preview · pick →          │       │
│ └──────────────────────────────┘       │
│ ┌──────────────────────────────┐       │
│ │ Vibe card 2                  │       │
│ └──────────────────────────────┘       │
│ ┌──────────────────────────────┐       │
│ │ Vibe card 3                  │       │
│ └──────────────────────────────┘       │
│                                        │
│ tertiary: ← Try a different hum        │
│ [bottom safe-area]                     │
└────────────────────────────────────────┘
```

**Desktop (bento):**

```
┌──────────────────────────────┬─────────────────────┐
│                              │  card 2 (top-right) │
│   card 1 (large, spans 2     ├─────────────────────┤
│   rows) — the strongest pick │  card 3 (bot-right) │
│                              │                     │
└──────────────────────────────┴─────────────────────┘
```

### Card design (simplified)

What's there today: wave clip-path (white-frosted top), gradient
bottom, particles, eyebrow "Mood," text, play/pause + Pick capsule.

What changes:

- **Drop the wave clip-path.** The gradient is the art; a frosted
  half-overlay competes with it. Replace with a soft 80% → 0% top fade
  so text stays legible without the wave shape.
- **Particles stay, but only on the active / auditioning card.**
  Inactive cards are still. Particles signal "this is what I sound
  like." A still card is "I'm waiting."
- **Card text is serif italic, not sans.** A vibe is a *poem*, not a
  setting. Use `font-serif-italic` for the title and tags.
- **One Pick affordance.** Today there's a play button and a Pick
  capsule. Make the entire card the Pick target. Long-press =
  preview. Lift = play locked. Single tap = commit + navigate.
  The Pick capsule becomes a hover-revealed `→` arrow at bottom-right.
- **Add a `↻ Re-roll` tertiary at the bottom.** Free (no notes —
  arrangement is local). Same melody, new seeded vibes. This is the
  "I want different options" affordance, not "redo my hum."

### Copy

- Headline (zh): *"听听看它能变成哪种歌。"*
- Headline (en): *"Pick the one your hum is asking to become."*
- Caption: *"长按预览 · 点击选择"* / *"Hold to preview · tap to pick"*
- Re-roll: *"换一组氛围"* / *"Try a different set"*
- Back: *"换一段哼唱"* / *"Try a different hum"* — returns to Hum,
  clears `vibeVersions`.

### Motion

- Each card rises in 80 ms apart with `rise-in`, staggered.
- On long-press: card scales up 1.02, particles activate, ambient audio
  starts. The other cards dim to 0.6 opacity.
- On commit: card scales to 0.96, a white pulse expands from its
  center, page fades to `/studio`.
- Re-roll: cards exit with `fade + y 8`, new cards rise in.

---

## 4. Studio `/studio` — *author*

**Current state:** wall of 28+ controls. The biggest UX failure in v1.

**Redesign:** the three-plane Compose from
[`docs/studio-compose-redesign.md`](studio-compose-redesign.md). This
section gives the visual + interaction details to ship it.

### Plane 1 — *Listen* (the default)

```
┌────────────────────────────────────────┐
│ ← back            (centered title)   ↻ │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │                                  │  │
│  │   HERO CARD (gradient)           │  │
│  │   eyebrow: VIBE NAME              │  │
│  │                                  │  │
│  │   hero-serif title (white)       │  │
│  │     "Soft Evening"               │  │
│  │                                  │  │
│  │                                  │  │
│  │             ▶ play (white circle)│  │
│  │                                  │  │
│  └──────────────────────────────────┘  │
│                                        │
│   meta row — eyebrow caps + ink         │
│   VIBE · 88 BPM · D MINOR · 0:32       │
│                                        │
│                                        │
│   editorial italic link:                │
│     "Tweak this song →"                │
│                                        │
│                                        │
│   ╭──────────────────────────────────╮ │
│   │   Save (black capsule, full-w)   │ │
│   ╰──────────────────────────────────╯ │
└────────────────────────────────────────┘
```

What this is: a *record cover*. The user lands and sees the result of
their hum + the vibe they picked. They can play it. They can save it.
That is the default UX path.

- Hero card height: 60% of viewport on mobile, 480 px on desktop.
- Gradient = the vibe's gradient. Particles drift at 0.3 density in the
  bottom half. Play button is a white-disc 56 px with a coral icon.
- Title is hero-serif, 32–48 px, white, displayed on the lower-left
  third of the card. Eyebrow above is `white/72`, 11 px,
  letter-spacing 0.28 em.
- Meta row uses `font-mono` for the BPM and duration numbers.
- "Tweak this song →" is an inline italic link in `accent-light`,
  underline-mm. Hover lifts 2 px. Click slides Plane 2 up from below.
- Save (black capsule) is **disabled** when balance < 1 and the
  caption reads *"Save — need 1 note · Top up"* with `Top up` linking
  to `/topup`.

### Plane 2 — *Tweak*

Slides up from below over Plane 1 (Plane 1 stays mounted, scaled to
0.96, dimmed to 0.4 opacity behind a 70% page-tint scrim — this preserves
context).

```
┌────────────────────────────────────────┐
│ ← back to Listen   (vibe name)         │
│                                        │
│   eyebrow: TWEAK                       │
│   hero-serif: "What should change?"    │
│                                        │
│   ╭──────────────────────────────────╮ │
│   │ Auris input — single line        │ │
│   │   "More strings · Warmer ·       │ │
│   │    Slower · …"                   │ │
│   ╰──────────────────────────────────╯ │
│                                        │
│   eyebrow: SHIFT THE MOOD              │
│   ┌──────────┐ ┌──────────┐            │
│   │ Warm     │ │ Cinematic│            │
│   │ ·        │ │ ··       │            │
│   └──────────┘ └──────────┘            │
│   ┌─────────────────────────┐          │
│   │ Minimal       Lush      │          │
│   │ ·             ··        │          │
│   └─────────────────────────┘          │
│   ┌──────────┐                         │
│   │ Brighter │                         │
│   │ ·        │                         │
│   └──────────┘                         │
│                                        │
│   tertiary row:  ↶ Undo   ↻ Restore    │
│                                        │
│   editorial italic link:                │
│     "Fine-tune mix →"                  │
└────────────────────────────────────────┘
```

What this is: a small editor that *interprets the user's intention*.
Five scene cards arranged in a bento, one Auris input, two micro
controls.

- Scene cards: bento layout (one big + two on right + one bottom on
  desktop; 1+2+1+1 stack on mobile). Each card is a colored panel
  with serif italic name + particle accent in the bottom 40%.
- Long-press scene: previews the result (synth restarts with the
  scene applied). Lift commits. Swipe-away cancels.
- Active scene gets a 1.5 px coral border. Inactive cards are still.
- Auris input: bottom-bordered, sans, `placeholder` is example prompts
  that rotate every 4 s (`"温暖一点"` → `"More space"` → `"Cinematic"`).
  Submit on Enter. Loading shows particle shimmer to the right of the
  input.
- Undo / Restore are small `text-[12px]` pills, not buttons.
- "Fine-tune mix →" link opens Plane 3.

### Plane 3 — *Balance* (the power-user mixer)

Same surface treatment as Plane 2 — sheet over Listen. Six instrument
rows (the existing TrackMixer, lightly retouched):

- Remove the colored bar gradient on the slider track — neutralize to
  `#E5DDD0`. The accent color stays in the **thumb** only, and only on
  the track that's actively being adjusted.
- The mute icon (♩ ♫ ≋ ◎ ▣ ∿) becomes a 24-px circle with the
  instrument's first letter (`P` `C` `S` `B` `D` `T`) — clearer than the
  decorative musical glyphs.
- Each row shows the resolved instrument name in `font-serif-italic`,
  mute color: *"piano"*, *"strings"* — not the SCREAMING ENUM.
- "Done" button at the bottom returns to Plane 2.

### Header

- Left: `← Listen` (or `← back to Listen` on Plane 2/3).
- Center: vibe name in caps, BPM in tabular numeric. *Not the song
  title* — that lives in the hero. (Today's double-title bug.)
- Right: `↻` Restore-all, with a confirm modal.

### Motion

- Plane 2 slide-up: 380 ms `mymind`. Plane 1 scales to 0.96 + opacity
  0.4 + blur 4 px. The user feels the listen page is "underneath."
- Plane 3 from Plane 2: same idiom; Plane 2 dims behind.
- Scene long-press: synth crossfades 200 ms in, particles spin up,
  scene card scales 1.025.
- Save: button press-down 0.97, then page slides up to Name.

---

## 5. Name `/studio/name` — *christen*

**Current state:** big serif headline, single underlined input, bottom
save. The skeleton is right; the experience is too quiet for the
"this is now a song" moment.

### Redesign

```
┌────────────────────────────────────────┐
│ ← back                                  │
│                                        │
│                                        │
│                                        │
│   eyebrow: NAME IT                     │
│                                        │
│   hero-serif:                          │
│     "What do you call                  │
│      this little song?"                │
│                                        │
│   ────────────────────────────         │
│   [Soft Evening]                       │
│   ────────────────────────────         │
│                                        │
│   caption: 16/80                       │
│                                        │
│   editorial italic suggestion row:     │
│     "Try: Soft Evening · Rain Song ·   │
│      Lemon Light"                      │
│                                        │
│                                        │
│   ╭──────────────────────────────────╮ │
│   │   Save (black capsule)           │ │
│   ╰──────────────────────────────────╯ │
│                                        │
│   processing copy slot                 │
└────────────────────────────────────────┘
```

What changes:

- Add an **eyebrow** "NAME IT" above the headline (parity with every
  other screen).
- Add a small **suggestion row** below the input: three serif-italic
  candidates separated by `·`, click to populate. The candidates are
  generated deterministically from the version seed, language, genre,
  mood, and scene. English uses multi-part song-title templates; Chinese
  mixes ci-pai names with guofeng title fragments so the row feels named
  rather than filled.
- The processing-copy slot uses the same rotating-copy idiom from Hum:
  *"saving · rendering · polishing · ready"* in serif italic, mute.
- On save success, the title morphs to the SongDetail hero (the
  promised handoff transition).

Visual rhythm: half the page is empty above the eyebrow. Don't center
content vertically — leave the bottom third for the input + CTA so the
moment feels intentional, not stranded.

---

## 6. SongDetail `/song/[id]` — *possess*

**Current state:** hero visual + "Live preview" status card + meta card
+ arrangement track list + share actions. The biggest problem is the
"Live preview" card — it exposes implementation detail (the synth-vs-
MP3 fallback) at the moment the user is supposed to *receive* their
song.

### Redesign intent

The screen treats the song as an **object** — a record sleeve. The
user can play it, name it (already named on Name), look at it, send
it, or destroy it. No more "live preview" affordance, no more
arrangement track-list breakdown.

### Layout

```
┌────────────────────────────────────────┐
│ ← back                          ⋯ menu │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │                                  │  │
│  │   COVER (gradient + particles +  │  │
│  │          subtle canvas viz       │  │
│  │          driven by playback)     │  │
│  │                                  │  │
│  │   eyebrow: VIBE NAME              │  │
│  │   hero-serif italic title         │  │
│  │                                  │  │
│  │            ⏵ large play disc      │  │
│  │                                  │  │
│  └──────────────────────────────────┘  │
│                                        │
│   meta row — eyebrow caps              │
│   88 BPM · D MINOR · 0:32 · MAY 30     │
│                                        │
│   editorial italic:                    │
│     "Made by humming, May 30."         │
│                                        │
│   ── Export ──────────────────────     │
│                                        │
│   ◯ Audio (mp3)         (free)         │
│   ◯ Share card (HTML)   (free)         │
│   ◯ Poster (PNG)        (free)         │
│   ◯ Audio video (MP4/WebM) (free)      │
│                                        │
│                                        │
│   tertiary footer:                     │
│     ↻ Edit again · ⌫ Delete            │
└────────────────────────────────────────┘
```

What changes:

- **Drop the "Live preview" status card.** No engineering exposure.
- **Drop the arrangement track list** in body. (It was a debug shape.)
  The data is implicit in the song; if the user wants to change it,
  they go to `Edit again`.
- **Single Play disc** centered in the cover. The cover is the play
  target on tap.
- **Cover canvas reacts to playback amplitude** — same idea as Hum's
  aurora reactivity, but inside the cover rectangle. Reuses
  `song-visual-canvas.tsx`.
- **Export becomes a list of named affordances**, each with its cost
  in notes called out in mute. The list is editorial — capsule pills,
  not big colored buttons. Free exports are right-aligned `free` in
  mute; paid exports show `2 notes` in mute.
- **Edit again** lives at the bottom as a tertiary link, not a
  prominent Sliders icon. The Sliders icon is gone (the user
  shouldn't be re-entering the editor as the main act on this screen
  — this is the *possess* moment).
- **Delete** lives in the top-right `⋯ menu`, with a confirm modal.
  The trash icon never appears on the page surface.

### Copy

- Caption under meta row: `*"Made by humming, <month day>."*` —
  serif italic, mute. Sets the mood: this is a hand-made artifact, not
  an algorithm output.
- Export labels are nouns, not actions: `Audio`, `Share card`,
  `Poster`, `Audio video`. The user knows they will *get* these
  things; the row is a menu of formats.

### Motion

- Arrive: cover scales 0.97 → 1, headline rises in. The title shares
  its starting position with where it was on Name (smooth handoff).
- Play tap: play disc swaps for pause; the cover canvas amplitude
  ripples to life over 800 ms.
- Export tap: the row scales 0.98, a small particle puff next to the
  format name, then the file is delivered (download / share sheet).

---

## 7. Gallery `/gallery` — *remember*

**Current state:** word-card MyMind grid. Already on-tone, but
under-developed: every cover is the same initials-on-gradient pattern;
the empty state CTA is generic; there's no sort / filter / search.

### Redesign

Keep the grid + word-card pattern; raise it to MyMind quality.

```
┌────────────────────────────────────────┐
│ [safe-area top]                        │
│                                        │
│ eyebrow: 7 SONGS                       │
│ hero-serif italic: "Things you hummed" │
│ caption: a quiet shelf of melodies     │
│                                        │
│   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐   │
│   │     │  │     │  │     │  │     │   │
│   │ ▩   │  │ ▩   │  │ ▩   │  │ ▩   │   │
│   │     │  │     │  │     │  │     │   │
│   └─────┘  └─────┘  └─────┘  └─────┘   │
│   *Soft     *Room    *Rain    *Tiny    │
│    Evening   Light    Song     Movie   │
│   88 BPM    72 BPM   60 BPM   84 BPM   │
│                                        │
│   ┌─────┐  ┌─────┐ … (more rows)       │
│                                        │
│                                        │
│   tertiary: + Try a new hum            │
└────────────────────────────────────────┘
```

What changes:

- **Cover art per song uses the vibe's actual `visualConfig.gradient`,
  plus a subtle generative pattern derived from the song's `keySignature`
  + `bpm`** (a small wave-like SVG path, deterministic per song). No
  more initials. Each song gets a fingerprint.
- **Titles in serif italic**, the existing MyMind style.
- **Long-press / right-click → context menu** with `Play`, `Edit`,
  `Delete`. Replaces the current "click to open" model with a richer
  per-card interaction.
- **Header is editorial:** eyebrow with count, italic headline,
  caption. No search bar in v2 (low value at <100 songs).
- **Empty state**: same shape (hero serif sentence + mute caption +
  one CTA), but copy is *"Nothing here yet. Hum your first one."* and
  the CTA is a coral capsule, NOT a generic mic-icon disc.
- **Add a quiet sort affordance** in the top-right of the eyebrow row:
  `↑ newest` / `↑ alphabetical` toggle, defaulting to newest.

### Pagination

- Load 24 cards; "Load 24 more" tertiary at the bottom.
- No infinite scroll — the editorial pace doesn't want it.

---

## 8. Me `/me` — *reflect*

**Current state:** profile + stats + language switcher + runtime
status block (debug strings) + manifesto + about. Mixed surface: user
identity + engineering debug. The redesign cleanly separates.

### Redesign

```
┌────────────────────────────────────────┐
│ [safe-area top]                        │
│                                        │
│ eyebrow: YOURS                         │
│ hero-serif italic: "A small shelf of   │
│                     your own."         │
│                                        │
│   ┌────────────────────────────────┐   │
│   │ UserBadge                       │   │
│   │   avatar · name · email         │   │
│   │   tier: Free  ·  region: Intl   │   │
│   │   [Sign out]                    │   │
│   └────────────────────────────────┘   │
│                                        │
│   ── Notes ──────────────────────────  │
│   ┌────────────────────────────────┐   │
│   │  12  notes                      │   │
│   │  signed in · notes balance      │   │
│   │  [Top up →]                     │   │
│   └────────────────────────────────┘   │
│                                        │
│   ── At a glance ───────────────────   │
│   7 songs · 4 vibes used · ∞ melodies  │
│                                        │
│   ── Language ──────────────────────   │
│   [中文] [English]                      │
│                                        │
│                                        │
│   ╭──────────────────────────────────╮ │
│   │ MANIFESTO BLOCK (dark)            │ │
│   │   "No ads, no feeds, no algorithm│ │
│   │    no likes."                    │ │
│   ╰──────────────────────────────────╯ │
│                                        │
│   ── About ─────────────────────────   │
│   serif sentence about Murmur          │
│                                        │
│   tertiary footer:                     │
│     ⌘ Settings · ⓘ Privacy ·            │
│     ⌫ Delete account                   │
└────────────────────────────────────────┘
```

What changes:

- **Remove runtime debug strings entirely.** No "remote-python ->
  browser-yin -> fixture." Move to `/me/debug?debug=1` per
  `docs/page-contracts.md` §7.
- **Add the Notes card** — balance + refill caption + Top up CTA.
  Coral mm-btn-primary.
- **Stats line** is one editorial sentence, not a 3-column number
  block. The current "∞ melodies" stat reads cleverly enough to keep.
- **Manifesto stays** — it's the single best piece of design copy in
  the product. Keep the dark block exactly as it is.
- **Settings / Privacy / Delete account** become tertiary footer links.
  They are not the main act of this screen.
- If the user is a **guest** (no identity bound), the page shows a
  prominent `Sign in` card above Notes:
  - eyebrow: `KEEP THESE`
  - hero-serif italic: *"Sign in so your songs travel with you."*
  - coral capsule: `Sign in with Apple` / `Sign in with Google` etc.

### Copy

- Eyebrow zh: `属于你`, en: `YOURS`.
- Headline zh: *"你的一小架歌。"* en: *"A small shelf of your own."*
- Local Creator notes caption: *"免费 5 枚用完后请登录继续。"* /
  *"5 free notes once. Sign in to continue."*
- About copy: the existing manifesto language, unchanged.

---

## 9. Topup `/topup` — *renew*

**New screen.** Specced in `docs/payment-topup-feature.md` §5.1 and
`docs/page-contracts.md` §8. The visual brief:

```
┌────────────────────────────────────────┐
│ ← back                                  │
│                                        │
│ eyebrow: MURMUR NOTES                  │
│ hero-serif: "More notes,               │
│              more little songs."       │
│                                        │
│   current balance — large numerical:    │
│       12 notes                          │
│   caption: one-time signup bonus, then top up │
│                                        │
│   ── Pick a top up ──────────────────  │
│                                        │
│   ┌──────┐ ┌──────┐ ┌──────┐            │
│   │ 30   │ │ 120  │ │ 400  │            │
│   │ notes│ │ notes│ │ notes│            │
│   │      │ │ ★    │ │ ✺    │            │
│   │ $1.99│ │ $5.99│ │$14.99│            │
│   └──────┘ └──────┘ └──────┘            │
│   ↑ small   ↑ pop    ↑ best             │
│                                        │
│   provider chip: pay via Stripe         │
│   (auto-selected by shell + region)     │
│                                        │
│                                        │
│   ╭──────────────────────────────────╮ │
│   │   Buy 120 notes — $5.99 (coral)  │ │
│   ╰──────────────────────────────────╯ │
│                                        │
│   tertiary footer:                     │
│     ↻ Restore purchases · Terms ·       │
│     Privacy                             │
└────────────────────────────────────────┘
```

What this is: a friendly purchase page that doesn't feel like a paywall.

- Balance is hero-class typography (40–60 px). It makes the user feel
  what they have before asking them to buy more.
- SKU cards are paper cards (`mm-card`), each with: notes count
  (big numeric), price (mute), star/sparkle badge for the highlighted
  SKU. The selected card has a 1.5 px coral border.
- The CTA at the bottom is dynamic: *"Buy 120 notes — $5.99."*
  Disabled until a SKU is selected.
- Pre-selection: the SKU with `highlight: "popular"` is selected by
  default.
- Provider chip is small, sans, mute — reassurance, not a UI feature.
- Restore purchases visible only on Capacitor shells.

### Copy

- Eyebrow zh: `音符`, en: `MURMUR NOTES`.
- Headline zh: *"再来几颗音符，多哼几首小歌。"*
- en: *"More notes, more little songs."*
- Signed-in balance caption: *"登录赠送 15 枚；之后可按需补给。"* /
  *"15 notes on sign-in; top up when you need more."*

---

## 10. Checkout `/topup/checkout` — *renew (handoff)*

**Receipt review + handoff.** Specced in `docs/page-contracts.md` §9. The
user confirms the top-up, receipt email, payment route, and policy acceptance
before the hosted provider page opens.

```
┌────────────────────────────────────────┐
│   centered ticket receipt:             │
│     white Murmur mark on ink header    │
│     notes / total / editable email     │
│     horizontal tear line               │
│                                        │
│   payment route note + terms checkbox  │
│   primary: "Pay securely" / "Sign in"  │
│                                        │
│   on success → toast + redirect /       │
│   on cancel → "No worries. Try again?"  │
│                                        │
└────────────────────────────────────────┘
```

The review state is a real design surface; the provider transition remains
brief and uses compact in-receipt busy feedback. The state machine is
`review → requesting → awaiting_payment → confirming → succeeded | canceled | failed`.

On `succeeded`: toast `+120 notes added.` + redirect to wherever the
user came from (referrer query param). If unset → `/me`.

---

## 11. Cross-cutting: nav

The bottom nav (mobile) + side nav (desktop) stays. Three items in v2:

- **Hum** (the orb mark)
- **Gallery**
- **Me**

Vibe and Studio are *flow* screens — they don't get nav slots. They
exist as steps in the journey, not destinations.

Topup is reachable from Me + from gated CTAs in Hum / Studio. Not a
nav item.

### Active state

The active nav item is in coral; inactive is mute. No background
chip, no underline — just color.

---

## 12. Cross-cutting: bottom-anchored CTAs

Studio / Name / Topup all have a sticky bottom CTA. Discipline:

- The CTA is **black** capsule for "Commit" semantics (Save, Buy).
- The CTA is **coral** capsule for "Begin / Open" semantics (Top up,
  Sign in).
- The CTA never has more than three words.
- Compact busy states stay contextual: use spinner / icon / text feedback that
  fits the control, while the canonical Murmur loading note is reserved for
  page-level loading.
- The CTA respects safe-area-inset-bottom.

---

## 13. What the redesign does **not** do

- It does not add page-level filters / search / sort beyond what's
  spec'd above. Murmur stays small.
- It does not add chrome (tabs, breadcrumbs, sidebars on flow screens).
- It does not introduce a dark mode in v2. The cream surface is the
  identity; a dark mode is a separate design pass.
- It does not personalize the headline copy ("Welcome back, …"). The
  product whispers; it doesn't address the user.
- It does not introduce confetti, success modals, or "achievement"
  patterns.

---

## 14. Sequencing for implementation

Order to ship the redesign:

1. **Studio** — the biggest fix, most user pain. Three planes, scenes
   simplified, mixer demoted. This proves the design language scales
   to a non-trivial page.
2. **SongDetail** — short page, high emotional charge. Removing the
   "live preview" engineering tell is a small diff with a big payoff.
3. **Me** — clean up the debug exposure, add Notes card.
4. **Vibe (promote to route)** — drop the wave clip-path, raise scene
   particles to "active-only," simplify card interactions.
5. **Name** — add eyebrow + suggestion row + processing copy.
6. **Gallery** — generative per-song covers + sort affordance.
7. **Topup + Checkout** — new pages, pair with Phase 4 of the
   execution roadmap.

This sequence trades total scope for emotional ROI: a user opening v2
should feel the change at Studio, the moment they're past Hum.

Sibling docs: `docs/design-language.md`, `docs/page-contracts.md`,
`docs/studio-compose-redesign.md`, `docs/payment-topup-feature.md`.
