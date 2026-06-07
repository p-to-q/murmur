# UI Inventory + Per-Page Plan

A complete map of Murmur's UI: the cross-cutting systems first, then every
screen with its current state, its problems, and a concrete plan. This is
the per-page work order for the design pass.

Read alongside `docs/design-language.md` (the visual system) and
`docs/page-redesign.md` (the per-page UX intent). Where this file and those
disagree, this file is newer and wins.

Status legend:
- 🟢 **solid** — works + on-tone, only polish left
- 🟡 **rough** — works but aesthetically/UX off, needs a real pass
- 🔴 **broken/placeholder** — missing, stubbed, or visibly wrong

---

## Part A — The systems (cut across every page)

### A1. Design language 🟢
`docs/design-language.md` + `globals.css`. Cream `#F5F1EB`, ink `#1A1A1A`,
one coral `#FF5924`. Instrument Serif (en) + LXGW WenKai TC weight 300 (zh).
The 8 anchor rules hold. **No change needed** — this is the spine; protect it.

### A2. Navigation 🟢 (just reworked)
- **SideNav** (desktop, collapsible 208/68px) — transparent, manuscript-style,
  three destinations + additive trail.
- **BottomNav** (mobile) — floating serif word-line, no pill chrome, hides on
  flow screens.
- **Trail model** (`nav-items.ts` `TRAIL_ROOTS` + `computeTrail`) — sub-flows
  hang under a destination and accrue (Vibe → Studio → Name stays additive,
  not replacing). Topup/Checkout hang under Me. **This is the general model**
  for any future sub-flow (billing, settings all go under Me this way).
- **Open polish:** the trail's visual language ("document outline" feel) still
  needs softening — see the user's note; it should read like a sentence
  growing, not a file tree. Tune indentation/separator, not the logic.

### A3. Shared visual components
| Component | Status | Note |
|---|---|---|
| `PageBackdrop` | 🟢 | aurora blobs, every screen. Good. |
| `MurmurWave` (canvas particles+sine) | 🟢 | in Vibe + Topup. **Underused** — belongs on SongDetail cover, Hum orb base, save-loading. |
| `SongCoverArt` (deterministic fingerprint) | 🟢 | Gallery tiles. Could also back SongDetail hero. |
| `MurmurMark` (bubbly wordmark) | 🟢 | locked by owner, keep. |
| `mm-card` / `mm-btn-primary` utilities | 🟡 | `mm-card` is a SaaS-ish white box; overused on Me. Consider a lighter "paper row" variant. |

### A4. i18n 🟢
`dict.ts` + `useTranslator`. Caveat: `t()` returns the **key string** on
miss, so `t(k) || "fallback"` never fires the fallback. Every new key MUST be
added to `dict.ts` or it leaks raw (this was the Topup bug). Rule: no
`|| "fallback"` as a substitute for a real dict entry.

### A5. State 🟢
`murmur-store` (flow) + `preferences-store` (repair bias) + `useUserBalance`.
Fine. SideNav reads pathname only for the trail now (no store dependency),
which is why the trail can't yet distinguish "walked through" vs "currently
on" — see A2 polish.

---

## Part B — The pages

11 real routes + 1 orphan. Ordered by the journey, not by priority.

### B1. Hum `/` — *capture* 🟢
**Now:** headline-left / orb-right, aurora reactive, bottom bar = demo link +
coral CTA, wordmark bottom-left. Balance chip removed this pass.
**Problems:** minor — the wordmark at 48px bottom-left competes a little with
the CTA; idle headline rotation at 5s is slightly fast.
**Plan:** leave the structure. Slow rotation to ~7s. Consider MurmurWave
faintly under the orb on `recording` state so the orb visibly "hears."
Priority: low.

### B2. Vibe `/vibe` — *discover* 🟡 → the dramatic peak
**Now:** iris-close arrival, 3 cards bento, MurmurWave at card bottoms,
long-press preview, tap commit.
**Problems:** card hierarchy is flat (all three feel equal — no "hero pick");
the wave can read busy when all cards animate; title typography not yet
pushed.
**Plan:** make card 1 dominant (bigger, more wave intensity at rest); cards
2–3 quieter until hovered. Active/auditioning card gets a clear lift +
brighter wave; others dim to 0.5. Push the vibe name to a large serif italic.
This is the product's signature moment — invest most here. Priority: **high**.

### B3. Studio `/studio` — *author* 🟡
**Now:** three planes — Listen (record-cover hero), Tweak (scenes + Auris),
Balance (slider mixer). v2 skeleton landed.
**Problems:** plane transitions are functional but not yet deliberate; the
mixer plane is still the most "control-panel" surface in the app; Auris input
voice is generic.
**Plan:** make Listen feel like holding a finished record (cover reacts to
playback). Tweak: scenes as editorial mood chips, Auris as a single quiet
ask-line. Balance: demote further — most users never need it; make it feel
like an "advanced drawer," not a peer plane. Priority: **high** (most surface
area, most user time).

### B4. Name `/studio/name` — *christen* 🟢
**Now:** eyebrow + serif headline + underlined input + 3 italic suggestions +
rotating save copy.
**Problems:** suggestions are vibe-keyed static lists (fine for v2); the page
can feel empty above the input.
**Plan:** keep. Maybe a faint MurmurWave or the song's SongCoverArt fingerprint
behind the input to tie naming to the artifact. Priority: low.

### B5. SongDetail `/song/[id]` — *possess* 🟡
**Now:** record-sleeve cover, meta, 4 named export affordances, edit/delete.
**Problems:** the cover does NOT yet react to playback amplitude (speced but
not wired); export rows could feel more like "objects you take" than a list.
**Plan:** wire cover canvas to playback (MurmurWave or analyser). Make the
hero title share position with Name's input for the morph transition. Export
list: each row a small tactile object. Priority: medium.

### B6. Gallery `/gallery` — *remember* 🟡
**Now:** word-card grid, deterministic SongCoverArt tiles, newest/A-Z sort,
empty state.
**Problems:** **empty state wastes the right half of the viewport** (the
single biggest "first impression" miss); populated grid is good; the
lineage/origin labels Codex added (`getLineageLabel`, `melodyOrigin`) add
metadata noise to tiles.
**Plan:** empty state — let MurmurWave/particles drift across the empty right
half as a "waiting shelf" mood; keep the left column quiet (headline + CTA).
Reconsider whether lineage labels belong on the tile or only on SongDetail.
Priority: **medium-high** (first-run impression).

### B7. Me `/me` — *reflect* 🟡
**Now:** 5 stacked white `mm-card`s (identity / notes / glance / language /
manifesto-ish) + about + footer links.
**Problems:** reads like a settings dashboard, not an editorial "you." The
card stack is the least Murmur-feeling screen in the app.
**Plan:** reshape from card-stack → **single typographic column** with hairline
section rules (like the SideNav manuscript style, scaled up). Identity as a
quiet line, notes as one big serif number, manifesto as the emotional anchor
near the bottom. Protect the manifesto copy — it's the best in the product.
Future billing/settings entries hang here as trail sub-rows (per A2 model).
Priority: **medium-high**.

### B8. Settings `/me/settings` — 🔴 unverified
**Now:** `SettingsScreen.tsx` exists (Codex). Not yet design-reviewed.
**Plan:** make it match the Me typographic column, not a forms page. Hangs
under Me in the trail. Priority: low until visually reviewed.

### B9. Debug `/me/debug` — 🟢 intentionally plain
Hidden power-user route. Leave plain. No design work.

### B10. Topup `/topup` — *renew* 🟢 (just fixed)
**Now:** big serif balance + MurmurWave + 3 SKU cards + dynamic CTA. i18n now
resolves.
**Problems:** SKU cards are slightly generic; provider chip is a stub string.
**Plan:** SKU cards as collectible "packs" rather than pricing tiles; tie the
selected pack to a wave-intensity bump. Priority: low (works, looks fine).

### B11. Checkout `/topup/checkout` — *handoff* 🟢
**Now:** state machine (requesting→succeeded), rotating copy, spinner.
**Plan:** keep minimal; tune copy + success moment. Priority: low.

### B12. VersionCardsOverlay.tsx — 🔴 ORPHAN
The old Vibe-as-overlay component. Superseded by `/vibe` route + VibeScreen.
**Plan:** delete it. Dead code. Priority: cleanup.

---

## Part C — Recommended sequence

By emotional ROI, not by file size:

1. **Vibe** — the signature peak; biggest payoff per hour.
2. **Studio** — most surface, most user time; three planes need deliberate feel.
3. **Me** — reshape card-stack → typographic column; highest "feels like
   Murmur" delta.
4. **Gallery empty state** — first-run impression; atmospheric fill.
5. **SongDetail** — wire the reactive cover; polish export objects.
6. **Hum / Name / Topup / Checkout** — polish only.
7. **Cleanup** — delete VersionCardsOverlay; review Settings.

One PR per page. Screenshot desktop (1280×820) + mobile (375×812) each.

---

## Part D — Cross-page polish backlog

- Trail visual language: soften from "document outline" to "growing sentence."
- `mm-card` overuse: introduce a lighter "paper row" for list contexts (Me).
- MurmurWave: extend to SongDetail cover + Hum recording state.
- CJK hero weight 300 is set; audit each page renders it (some may still
  cascade 400 if they don't use `.hero-serif`).
- Idle/loading copy rotation timing consistency (Hum 5s vs others 0.9s).
