# Design Language

The Hum screen works. Every other screen ships against a vague version
of the same aesthetic and gets it wrong. This document extracts what
Hum is doing right and locks it as the system every other screen must
satisfy. When a page feels off, the diagnosis is "which rule below is
it breaking."

This is **not** a token spec. The tokens are in
[`src/app/globals.css`](../src/app/globals.css). This is the
**vocabulary** — how the tokens combine to feel like Murmur.

---

## 1. Anchor: what Hum is doing right

Lay the Hum screen on the table and list everything it asserts:

1. **One decision per screen.** A press-hold orb. Not three buttons.
2. **Atmosphere first, controls second.** Four aurora blobs drift in
   the background before any UI appears. The mood arrives before the
   instruction.
3. **Magazine hierarchy.** Eyebrow → big serif headline → tiny mute
   caption. Three sizes, three weights, three colors. Done.
4. **One signature color.** Cream surface, near-black ink, one
   coral accent (`#FF5924`). Everything else is mute.
5. **Calm motion.** Springs, drifts, breath. No spectacle. The biggest
   animation on the page is a 28-second blob loop you barely notice.
6. **Reactivity, not decoration.** Particles + blobs **respond to the
   user's voice**. Motion means something.
7. **Generous negative space.** ~40% of the viewport is empty. The orb
   is one element on an otherwise-quiet stage.
8. **Copy that whispers.** "Hum a tune you can't get out of your head."
   Editorial sentences, not UI labels.

Every other page must obey these eight before it ships. If a redesign
breaks one of them, it is wrong.

---

## 2. The visual system

### 2.1 Color

| Role | Token | Hex | Use |
|---|---|---|---|
| Page surface | `--color-murmur-bg` | `#F5F1EB` | every screen background |
| Page surface (warm) | `--color-murmur-bg-warm` | `#EFE8DA` | nav, secondary surfaces |
| Card | `--color-murmur-card` | `#FFFEFB` | paper cards (mm-card) |
| Ink | `--color-murmur-ink` | `#1A1A1A` | headlines, body |
| Ink soft | `--color-murmur-ink-soft` | `#3A3A3A` | secondary body |
| Mute | `--color-murmur-mute` | `#8C8780` | captions, meta |
| Mute light | `--color-murmur-mute-light` | `#B6B0A4` | timestamps, hints |
| Border | `--color-murmur-border` | `#E5DDD0` | card edges |
| Border strong | `--color-murmur-border-strong` | `#D2C9B6` | dashed edges, dividers |
| Accent | `--color-murmur-accent` | `#FF5924` | one per screen — CTA, signature mark |
| Accent light | `--color-murmur-accent-light` | `#FF8A5C` | eyebrow over headline |
| Accent deep | `--color-murmur-accent-deep` | `#D9421A` | hover state for CTA |
| Accent tint | `--color-murmur-accent-tint` | `#FFE6DA` | highlight wash |
| Dust blue | `--color-murmur-dust-blue` | `#A7B8C8` | vibe palette only |
| Lavender | `--color-murmur-lavender` | `#C9B6E4` | vibe palette only |
| Warm gold | `--color-murmur-warm-gold` | `#EBCB8B` | vibe palette only |

**Rules:**

- Coral `#FF5924` is the **only** non-vibe accent. One per screen,
  reserved for the screen's primary action or the screen's signature
  thread (e.g. progress ring, eyebrow). Two coral elements competing
  for attention is the most common Murmur design error.
- Vibe colors (dust blue / lavender / warm gold) only appear inside
  vibe gradients, never as UI chrome.
- No new colors. If a design wants a fourth or fifth hue, it is
  decoration — delete it.
- Ink hierarchy is `ink > ink-soft > mute > mute-light`. Body text is
  never `ink-soft` and a caption above it `mute`. Stagger by one step.

### 2.2 Typography

Two type families, three roles. The editorial (art) face always wins a
tie: anything with a voice — titles, named artifacts, captions, editorial
links — is serif/WenKai. Everything functional is sans. There is no third
label family; a micro-label is just small, tracked, uppercase sans.
(A third face, `Murmur Datatype`, was trialed for micro-labels and
retired: its `@font-face` was never wired up, it had no CJK glyphs — so
Chinese labels silently mixed two faces inside one string — and it broke
the tracked-caps label rhythm that Studio / Vibe / Name / PublicSong
kept. Don't reintroduce a label-only family.)

| Role | Family | When |
|---|---|---|
| **Hero serif** | `Instrument Serif` (en) / `LXGW WenKai` (zh) | page anchors — the one big editorial moment per screen |
| **Hero serif italic** | same, italic (zh stays upright WenKai) | song titles, named artifacts, mymind-flavored captions, editorial links |
| **Sans body** | `Geist Sans` / `PingFang SC` / system sans | all other text, incl. micro-labels (small + uppercase + 0.14–0.32em tracking) |

Font loading is a product pipeline, not a component detail:

- `src/app/layout.tsx` registers the brand faces (`next/font` for
  Instrument Serif + Geist, `@fontsource` CSS for LXGW WenKai).
- `FontHydrator` owns `document.fonts.load(...)` readiness and sets
  `html[data-fonts]`.
- `.font-critical` text keeps its layout space but stays invisible while
  brand-critical fonts are still loading, preventing onboarding and Home hero
  copy from flashing system fallback glyphs mid-animation.
- Native app shells should mirror the same roles: bundle brand fonts locally,
  preload them during launch/onboarding, and gate brand copy until the platform
  reports those faces ready.

Scale (Pixel, mobile / desktop):

| Use | Size | Tracking |
|---|---|---|
| Display headline (Hum-class moment) | 36 / 60–76 | -0.015em |
| Section headline | 28 / 42 | -0.012em |
| Card title | 22 / 28 | -0.005em |
| Body | 14–15 | 0 |
| Meta | 12–13 | 0 |
| Eyebrow (uppercase) | 11 | 0.32em |
| Micro-label (uppercase sans) | 10–12 | 0.14–0.32em |
| Tabular numeric | 12–13 | 0 (font-feature `tnum`) |

**Rules:**

- Every screen has **exactly one** hero-serif moment. The screen's
  identity. No screen has two hero-serif blocks competing.
- The eyebrow above a headline is `accent-light` (`#FF8A5C`), uppercase,
  0.32em tracking, 11 px. Always.
- Captions / footnotes / subtitles use sans, mute. Never serif at small
  sizes.
- Numbers in counters / balances / BPM use tabular-numeric so they don't
  jitter as they update.
- Chinese text uses the same scale; CJK sans text falls through to system
  Chinese faces, and editorial Chinese title text uses the LXGW WenKai stack.

### 2.3 Surface + edge

- Page background: cream (`#F5F1EB`) + `PageBackdrop` (4 aurora blobs).
- Card: paper (`#FFFEFB`) + 10 px border-radius + 1 px border
  (`#E5DDD0`) + a barely-there shadow. The class is `mm-card`.
- Hero panels (Studio listen card, SongDetail hero): **22–28 px**
  border-radius, gradient surface, white text. The page is paper; the
  hero is a print.
- Buttons:
  - Primary: coral capsule (`mm-btn-primary`).
  - Secondary: black capsule (`bg-[#1A1A1A] text-white`). Reserved for
    "commit" moments like Save.
  - Tertiary: ghost (text-only) with `underline-mm` on hover.
- Inputs: bottom-bordered, not boxed. Border `#D2C9B6` resting,
  `#FF5924` focused. (See NameScreen's existing input — keep this.)
- Dividers are negative space, not lines. We never paint a horizontal
  rule across a page.

### 2.4 Iconography

- Lucide line icons. `1.5 px` stroke, never filled, 16–20 px sizes.
- No iconography in headlines, no iconography as decoration.
- The white-orb on Hum is the **only** large abstract circle in the
  product. Don't reuse the conic-glow pattern for "play" buttons or
  similar — it's the Hum signature.

---

## 3. Motion system

Murmur's motion is **calm** + **purposeful**. Every animation answers
either "what is happening" or "what mood am I in." Never "look what
this can do."

### 3.1 Eases

| Name | Cubic-bezier | Use |
|---|---|---|
| `mymind` | `cubic-bezier(0.22, 1, 0.36, 1)` | the default — entrances, micro-interactions |
| `iris` | `cubic-bezier(0.65, 0, 0.35, 1)` | transition between pages of high emotional charge (camera-snap) |
| `spring-soft` | `framer-motion` `{ stiffness: 200, damping: 24 }` | button press, hero tilt |
| `spring-tight` | `{ stiffness: 320, damping: 28 }` | scene preview commit |
| `linear` | reserved for `glow-spin` only | continuous decorative motion |

### 3.2 Durations

| Tier | ms | What |
|---|---|---|
| Tactile | 150–180 | button press, hover lift |
| Reveal | 350–500 | element fade-in, scene swap |
| Statement | 600–800 | hero transitions, vibe-pick → studio |
| Atmospheric | 20 s+ | aurora drift, conic glow |

If a transition does not match a tier, it is the wrong duration.

### 3.3 Reusable motion idioms

These are the named idioms every screen reuses. Adding a new idiom is a
design decision; an agent does not invent motion ad-hoc.

| Idiom | What it looks like | Where it appears |
|---|---|---|
| **rise-in** | `opacity 0 → 1, y 10 → 0`, 700 ms `mymind` | every hero text block, every first-paint headline |
| **soft-tilt** | `whileHover { y: -3 }`, 350 ms `mymind` | every clickable card |
| **press** | `whileTap { scale: 0.92 }`, spring | every interactive element |
| **aurora drift** | 22–34 s loops on PageBackdrop | always present, all screens |
| **glow-spin** | 20 s linear conic rotation | Hum orb only |
| **breathe** | 2.5 s scale 1↔1.04 | Hum idle orb, save success confirmation |
| **iris-close → rainbow ring → iris-open** | 700 + 550 ms | Hum → Vibe handoff only (signature) |
| **scene-particle rise** | 4–5 s upward float | vibe cards, scene cards |
| **ring-progress** | linear stroke-dashoffset over recording duration | Hum recording, save render progress |
| **hero-zoom** | `scale 0.97 → 1`, 600 ms `mymind` | every screen's hero block as you arrive |

### 3.4 Where motion is forbidden

- No bouncing / overshoot on hovers.
- No parallax on scroll.
- No marquee, no auto-rotate carousel.
- No skeuomorphic 3D rotations.
- No animation longer than 800 ms for any interaction the user is
  waiting on.
- No more than two simultaneous attention-grabbing motions on a screen
  at one time. Aurora is permanent and doesn't count.

---

## 4. Layout system

### 4.1 The grid

- Mobile: single column, 20 px gutter, content max-width = viewport.
- Tablet / desktop: two-column **only** when there is a clear
  primary + secondary relationship. Otherwise one centered column,
  max-width 720–960 px.
- Side nav (desktop): 252 px fixed, see `side-nav.tsx`. Content sits in
  the remaining column with `md:pl-[232px]` etc.
- Hero blocks on desktop: 1.15fr / 1fr split (the Hum left-text /
  right-orb pattern, applied wherever a screen has dominant + supporting
  content).

### 4.2 Spacing

| Token | px | Use |
|---|---|---|
| `gap-2` | 8 | inside meta pills, button groups |
| `gap-4` | 16 | between siblings inside a card |
| `gap-5` / `gap-6` | 20–24 | between cards |
| `gap-10` / `gap-12` | 40–48 | between sections |
| `py-8` / `py-10` | 32–40 | section vertical rhythm |
| `pt-14` / `pt-16` | 56–64 | safe-area-aware page top |

Generous, not tight. A page that looks dense is wrong.

### 4.3 Edges

- Every screen renders inside a `relative min-h-svh bg-[#F5F1EB]`
  container with `<PageBackdrop />` as the first child.
- `<PageBackdrop variant="soft" />` on screens with dense content (the
  current Studio, redesigned Compose, SongDetail meta block). Default
  on hero-class screens (Hum, Vibe, Name, Topup).
- Safe-area: every screen with a top header uses
  `paddingTop: max(env(safe-area-inset-top, 0px), 28px)` for header
  rows. Every screen with a fixed bottom bar uses
  `bottom: env(safe-area-inset-bottom, 0px)`.

---

## 5. Interaction grammar

### 5.1 The signature gestures

| Gesture | Used by | Means |
|---|---|---|
| Press-and-hold on a primary circle | Hum orb | "Capture while I hold." Release commits. |
| Tap on an item card | Vibe / Gallery / Scene | "Pick this." Single tap commits. |
| Press-and-hold on a scene card | Studio scenes | "Preview." Release commits, swipe-away cancels. |
| Bottom-anchored capsule CTA | Save (Studio / Name) | "Commit and proceed." |
| Top-left back arrow + top-right utility | Studio / SongDetail / Topup | Standard header. Title centered between. |

These are the only gestures. New ones need a doc note.

### 5.2 Feedback

- Every commit-tap shows a 200 ms scale-down + a haptic on mobile.
- Every async action shows the **rotating editorial copy** pattern
  established on Hum's "listening / polishing / adding drums / three
  vibes" rotation. Same component, different verbs per page.
- Errors never appear as red banners. Errors appear as a single quiet
  card that names what failed in editorial copy, plus one Retry pill
  and one "try a different way" link. (See HumScreen mic-failed card.)
- Successes never show a confetti or modal. Successes navigate, with a
  toast at most.

### 5.3 Empty states

- Big hero serif sentence.
- One mute caption.
- One coral primary CTA.
- Nothing else.

Refer to GalleryScreen's existing empty state — copy that pattern.

---

## 6. Anti-patterns we already see in the codebase

These are the failure modes specifically present in the v1 pages, so
designers / agents can recognize them and stop.

| Anti-pattern | Where | Why it's wrong |
|---|---|---|
| **Multi-card stack with no hierarchy** | StudioScreen | Every block looks equally important. The user has no entry point. |
| **6 sliders + 9 chips + 5 scenes on one page** | StudioScreen | DAW-grade option load on a low-stakes Compose screen. |
| **Runtime debug strings shown to user** | MeScreen | "remote-python -> browser-yin -> fixture" is engineering scratch, not product copy. |
| **"Live preview" alongside the saved version** | SongDetailScreen | Implementation detail leaking into the artifact moment. |
| **Two song titles on one page** | StudioScreen (header + hero) | Same string, two sizes, no story. |
| **Generic placeholder gradients on cards** | GalleryScreen (initials covers) | Every song looks the same; no memory anchor. |
| **Wave clip-paths competing with particles** | VersionCardsOverlay | Too much ornament; the gradient is the mood. |
| **Empty-state CTA that doesn't match the page tone** | empty Gallery (orange disc with mic icon) | Reads "blank state of a SaaS app." |

These are the diagnoses the redesign acts on.

---

## 7. What "consistent with Hum" means in practice

When the design is right, the user feels these without being told:

1. Every screen has the same paper-cream surface and the same gentle
   aurora glow underneath it.
2. Every screen has **one** hero serif sentence that names what this
   screen is for, sized like a magazine.
3. Every screen has **one** orange action; the rest is mute, paper, and
   typography.
4. Every transition between two screens reuses an idiom they've already
   seen — never a new motion pattern just for this jump.
5. Every change in state is visible without a notification toast.
6. Every screen breathes — there's air between elements.
7. Every screen could be a magazine spread with one decisive headline,
   not a dashboard.
8. When the user is recording or processing, motion is reactive to what
   they are doing.

If five of these eight are not true on a screen, the screen is not
done.

---

## 8. Where this language is enforced

| Concern | Enforced by |
|---|---|
| Color tokens | `globals.css` `@theme inline` block + Tailwind |
| Motion idioms | Named in this doc; built into shared components (`PageBackdrop`, particle classes, etc.) |
| Typography | `.hero-serif`, `.eyebrow`, `.font-serif-italic` utilities |
| Surface + cards | `.mm-card`, `.mm-btn-primary` utilities |
| Interaction grammar | Per-page contracts in `docs/page-redesign.md` |
| Anti-pattern avoidance | This doc §6 + design review of the PR |

Sibling docs: `docs/page-redesign.md` (the per-page application),
`docs/page-contracts.md` (the data contracts each page satisfies),
`docs/studio-compose-redesign.md` (the specific Compose simplification).
