# Studio / Compose Redesign Brief

## 1. Goal

Studio (the post-Vibe arrangement screen) currently exposes ~28 interactive
surfaces on one page (see `diagnosis-2026-06.md` §3). The user's instinct
is right: this is too many. This document specifies the simplified Compose
surface to replace it.

**This doc designs the surface, not the engines.** The arrangement engines
(`apply-edit.ts`, `assemble-song.ts`, the LLM token classifier) work and
stay. The visible UI shrinks; the mutation surface stays narrow.

## 2. Anchor + non-goals

Anchor: AGENTS.md already says **"Studio is intentionally not a DAW."**
That intent has drifted in the implementation. The redesign re-aligns the
UI to it.

Out of scope:

- Adding new EditTokens.
- Adding new instruments / vibes / scene presets.
- Changing the arrangement model.
- Changing the save flow (NameScreen + `/api/songs`).

In scope:

- What the user sees on Studio.
- Information architecture.
- How edits surface and how the user understands their effect.
- Behavior on the Hum-to-Studio handoff.

## 3. Diagnosis recap (one paragraph)

The current Studio page shows: hero card with play, overview pill block
(4 chips), AurisPanel (text input + 9 quick chips in 3 groups),
TrackMixer (6 toggle+slider rows), SceneGrid (5 scene cards), Save CTA,
plus header (back / title / restore). That is 24+ touch targets stacked
vertically. There is no information hierarchy and no concept of "what is
this song right now" vs "what would change if I tap that."

## 4. Compose v2 — three planes, not one wall

The redesign collapses Studio into **three sequential planes**, only one
visible at a time, swipe / tab to move:

```
┌──────────────────────────────────────────────┐
│ Plane 1: LISTEN                              │
│  - hero visual + play                        │
│  - 4 meta pills (vibe / key / BPM / length)  │
│  - one inline button: "Tweak"  →  Plane 2    │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ Plane 2: TWEAK                               │
│  - 5 scene cards (warm / cinematic / minimal│
│    / lush / brighter) — bigger, bento style  │
│  - one inline Auris input ("Tell Auris…")    │
│  - undo + restore-all chips                  │
│  - back → Plane 1                            │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ Plane 3: BALANCE (optional, "Pro" affordance)│
│  - the existing 6-slider TrackMixer          │
│  - opened from a small "fine-tune" link in   │
│    Plane 2, never visible by default         │
└──────────────────────────────────────────────┘
```

Why this works:

- The **default** Compose experience is Plane 1 (listen) + Plane 2 (mood
  tweaks). Five scene cards and a single text input cover ~90% of the
  edits a non-musician will make.
- The slider mixer (which scares non-musicians and bores musicians) is
  reserved for a single intentional "fine-tune" click.
- Save is on Plane 1 + Plane 2, always one tap away.

This is closer to MyMind: one decisive thing per screen, generous
hierarchy, every page is an "aha" rather than a tool wall.

## 5. Scene cards as the dominant edit surface

The five scenes already exist:
[scene-presets.ts](../src/components/studio/scene-presets.ts).
Make them the dominant Plane 2 element with three changes:

1. **Bigger cards.** Bento layout (2 + 3 or 1 + 2 + 2) instead of a
   uniform row. The dominant card hosts the just-applied mood, others
   are secondary.
2. **Preview-on-hold.** Press-and-hold a card to audition its result; lift
   to commit, swipe-away to cancel. The current scene-tokens API already
   composes per-press; this is purely UI.
3. **Particle accent communicates state.** Particles are visible only on
   the *currently active* scene card; others are still. Right now they
   animate on all cards, which dilutes the "where am I" signal.

Scene labels stay copy-driven via i18n keys.

## 6. Auris input — keep, slim down

Keep the natural-language input
([auris-panel.tsx](../src/components/studio/auris-panel.tsx))
but:

- **Remove the 9 quick chips.** They duplicate the scene cards (mood
  group) or the TrackMixer (balance group, motion group). Quick chips are
  triage decoration; we either use scenes (mood-shaped) or sliders
  (parameter-shaped) but not a third surface.
- Restyle: single line, single submit. Below it, two micro-pills:
  `Undo` and `Restore`. That's it.
- Loading state: replace the `…` placeholder with an inline particle
  shimmer so the user sees Auris "thinking" instead of nothing.

The LLM classifier route
([api/strummer/edit](../src/app/api/strummer/edit/route.ts))
does not change. It still returns EditTokens that `applyEdit` consumes.

## 7. TrackMixer — demote to Plane 3

Keep
[track-mixer.tsx](../src/components/studio/track-mixer.tsx)
intact but hide it by default. Surface it from a small inline link on
Plane 2:

> _细调音量？_ → **Fine-tune** ↗

On click, Plane 2 swaps for Plane 3. Save and back stay accessible. This
preserves the affordance for power users without imposing it on
first-timers.

When we move multi-platform (see `cross-platform-strategy.md`), Plane 3 is
the surface most likely to differ per-shell — on 微信 MP we might
deliberately omit it in v1.

## 8. Plane 1 redesign — hero + meta

The current hero card has the title twice (once in header, once on the
gradient hero). Collapse:

- One hero card with gradient, big serif title, vibe eyebrow, play /
  pause control. No duplicated title in the small status bar above.
- The 4 meta pills get a `Length` chip (replacing duplicated melody
  instrument) so the user knows song duration at a glance.
- Inline below the hero: a single "Tweak this song →" link that opens
  Plane 2. No persistent "Mixer / Scenes / Auris" headers.

## 9. Hum → Compose handoff

After the user picks a Vibe card, today they land in StudioScreen with no
introduction. Add a 600 ms transition that:

1. Plays a 4-bar preview of the assembled song automatically.
2. Animates the chosen vibe card → hero card so the user feels continuity.

This is product-feel work, not architecture, and is the main "MyMind aha
moment" the user keeps asking for in this stage.

## 10. Restore + undo behavior

Currently `restore_all` resets all 6 tracks to original. We add:

- An **undo stack** at the Compose-screen level (not engine-level): every
  successful `applyEdit` call pushes the previous `arrangementState` to a
  ring buffer of 10. Undo pops one entry. This is purely client-side
  state; no DB or engine change.
- Existing `restore_all` stays as the "nuke" option.

UI: undo + restore are two micro-pills next to the Auris input. No
keyboard shortcut work for v2 (web-only affordance, doesn't survive
mobile).

## 11. Behavior the redesign **does not** change

- Save flow (Studio → NameScreen → `/api/songs`). Untouched.
- LLM classifier route. Untouched.
- `applyEdit` allowlist. Untouched.
- `assemble-song.ts` + synth + render. Untouched.

The audio pipeline redesign (`audio-pipeline-redesign.md`) is
independent — Compose v2 can ship before or after it.

## 12. Acceptance criteria

A downstream agent has shipped this when:

- [ ] Plane 1 (Listen) is the default Studio surface; only the hero +
      meta pills + Tweak link are visible.
- [ ] Plane 2 (Tweak) shows 5 scenes (bento layout) + 1 Auris input +
      Undo + Restore.
- [ ] Plane 3 (TrackMixer) only appears after explicit "Fine-tune" click.
- [ ] Scene press-and-hold previews; lift commits; swipe-away cancels.
- [ ] Hum → Compose transition autoplays a 4-bar preview.
- [ ] Compose-level undo works for the last 10 edits.
- [ ] No regressions: existing EditTokens still apply, LLM endpoint still
      classifies, Save flow unchanged.

## 13. Out of scope (this doc)

- New EditTokens.
- New scenes / vibes.
- Visualizer redesign on SongDetailScreen.
- Gallery / MeScreen UI changes (separate brief).
- Touch / haptics on mobile shells (covered when Capacitor lands).

## 14. File touch list

- `src/components/screens/StudioScreen.tsx` — restructure into three planes
- `src/components/studio/scene-grid.tsx` — bento layout + press-and-hold
- `src/components/studio/auris-panel.tsx` — remove quick chip groups,
  collapse to single input + undo/restore
- `src/components/studio/track-mixer.tsx` — no API change; moved to Plane 3
- `src/lib/store/murmur-store.ts` — add `composeUndoStack: ArrangementState[]`
- `src/lib/i18n/dict.ts` — copy for "Tweak", "Fine-tune", "Undo"
- (new) `src/components/studio/compose-plane.tsx` — plane container with
  swipe / tab

## 15. Open questions

1. Should Plane 1 also surface the LLM-generated title editing inline, or
   stay limited to NameScreen? Recommend NameScreen — keeps Compose about
   sound.
2. Should "Tweak" support **A/B compare** (left swipe replay original,
   right swipe replay edited)? Strong UX, but doubles synth state. Park
   for v3 unless feedback demands.
3. Does the LLM route surface a "what changed" sentence we can show as a
   toast? Today the route returns `tokens` only. Worth an extension to
   `reason` in v2.5 — already in route response shape but unused on the
   client.

Sibling: `audio-pipeline-redesign.md` (independent),
`payment-topup-feature.md` (locks the Save gate),
`execution-roadmap.md`.
