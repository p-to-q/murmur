# Murmur Humming Engine v2

## 1. Product goal

Murmur's core engine is not a generic "music AI" system and not a query-by-
humming search engine. It is a **humming-to-song engine** with two top-level
user promises:

1. **"This still feels like what I sang."**
   The result should preserve the user's melodic intent, phrase direction, and
   rhythmic skeleton even when the original singing is imperfect.
2. **"This sounds accurate and musical."**
   The result should sound in tune, phrase like a song, and hold up when placed
   over a simple but attractive accompaniment.

The engine therefore optimizes for:

- melodic intent over raw waveform fidelity;
- pitch correctness over literal frame-by-frame imitation;
- musical plausibility over blind note quantization;
- small, legible corrections over maximal algorithmic intervention.

## 2. Non-goals

This v2 plan intentionally does **not** optimize for:

- full vocal performance preservation;
- karaoke scoring;
- polyphonic transcription;
- end-to-end black-box song generation;
- large model inference everywhere by default.

The default assumption is that the user is singing a **lead melody sketch**.
If accompaniment is sparse or absent, the product should still return a strong
melody-plus-piano/guitar style result.

## 3. Product principles

### 3.1 Preserve intent, not every artifact

We preserve:

- contour direction;
- strong-beat anchors;
- phrase endings;
- repeated motives;
- relative pitch motion.

We do not attempt to preserve every:

- micro-slide;
- unstable tail wobble;
- breath-adjacent pitch burst;
- accidental in-between pitch.

### 3.2 Accurate means "musically right"

For Murmur, "accurate" is not the same as "closest frequency estimate."
The engine should aim for the melody the user **meant** to sing:

- a stable long note matters more than a noisy transient;
- a phrase ending matters more than a mid-phrase wobble;
- a strong beat matters more than a weak-pulse grace fragment;
- a clean resolution matters more than literal reproduction of a missed pitch.

### 3.3 Pleasantness can outrank strict fidelity in bad takes

When the take is poor, Murmur may favor a more musical result as long as it
does not betray the melody's identity. This is the intended product behavior,
not a fallback bug.

### 3.4 Advanced control stays off the front door

Murmur should keep the everyday creation path simple:

`Hum -> Vibe -> Studio -> Save`

That means:

- no provenance-heavy UI on the first recording screen;
- no technical confidence panels in the main creation flow;
- no forcing users to choose engine details before hearing a result.

If we expose deeper control, it should live in quieter surfaces such as:

- `Me!` for durable global preferences;
- `Gallery` / saved-song surfaces for trace, branch, and source review.

This is a product rule, not just a design suggestion. The system may become
more capable over time, but the main path should stay emotionally lightweight.

## 4. Non-degradation rules

Any future web, Flutter, worker, or backend rewrite should preserve these
guardrails:

1. **Do not make the default result less recognizable.**
   If the output no longer feels like the user's melody idea, the engine has
   regressed even if it measures better on generic transcription metrics.
2. **Do not over-correct stable notes.**
   High-confidence anchors, phrase endings, and repeated hooks should move less
   than noisy fragments.
3. **Do not expose complexity earlier than needed.**
   Advanced controls belong after trust is established, not before.
4. **Do not require cloud-only execution for a basic usable preview.**
   Device-capable paths may be lighter, but they must remain musically valid.
5. **Do not let “better sounding” become arbitrary rewrite.**
   Pleasantness is allowed to outrank strict fidelity only when the take is
   weak or ambiguous.

## 5. Product surface map

The engine may grow more capable, but capability should land in the right
surface.

### 5.1 Front-door path

`Hum -> Vibe -> Studio -> Save`

This path should only expose:

- recording guidance simple enough to act on immediately;
- one clear result direction at a time;
- no provenance jargon, confidence breakdowns, or branch history;
- no settings that ask the user to think like an audio engineer.

### 5.2 Quiet control surfaces

Advanced or durable control belongs here:

- `Me!`
  for global taste preferences such as a fidelity-to-pleasantness bias.
- `Gallery`
  for looking back at where a saved song came from.
- `Song detail`
  for lightweight lineage, saved melody stance, and export-grade context.

Current product stance:

- the front door only asks the user to hum, choose a vibe, and keep moving;
- saved-song surfaces may expose `melody stance`, `version path`, and a small
  `editing cue`;
- provenance should read like product memory, not like an engineer console.

That means the right implementation pattern is:

- short expandable trace cards in saved-song detail;
- durable taste controls in `Me!`;
- no confidence breakdowns, detector names, or repair jargon in the first-run
  capture flow.

### 5.3 Copy stance for the bias control

The user-facing framing should stay human and non-punitive:

- left side: `Closer to your hum`
- right side: `More songlike`
- right-side note: `Hey, this is not us saying you sang badly.`

The control is there to resolve ambiguity, not to blame the singer.

## 5.4 Local acceptance corpus

Murmur should keep a standing unattended acceptance corpus on one machine.
That corpus should not only cover happy paths. It should always include:

- familiar melody anchors;
- noisy / quiet / clipped capture variants;
- overheld interior-note cases;
- pitch-weak but rhythm-stable cases;
- urgent, short-gap hook fragments.
- glide-heavy phrases that should not be oversplit.
- light vibrato phrases that should not turn into fake extra notes.

The point is to keep product intent grounded in repeatable engineering
evidence. If a later rewrite scores well on one neat demo but fails this corpus,
the engine is not actually healthier.

## 6. Runtime model

Murmur should support two execution modes behind one shared contract.

### 6.1 Cloud mode

Use when:

- network is available;
- the user permits upload;
- the backend is healthy;
- we want the highest-confidence final result.

Cloud mode is the default path for:

- full denoise;
- heavier pitch / phrase analysis;
- stronger correction and polish;
- save/export-grade render decisions.

### 6.2 Device mode

Use when:

- the user prefers local processing;
- the backend is saturated;
- the device is capable enough;
- we need immediate feedback.

Device mode should support:

- recording quality checks;
- trim + light denoise;
- lightweight F0 contour extraction;
- coarse note segmentation;
- light correction;
- quick piano/guitar preview.

### 6.3 Shared contract

Cloud and device must return the same conceptual objects:

- `IntentMelody`
- `CorrectedMelody`
- `MusicalMelody`
- diagnostics and confidence summaries

This keeps the product logic stable while inference strength varies.

## 7. Three-layer melody model

The engine should not collapse everything into one output melody too early.

### 7.1 IntentMelody

Most faithful to the user's melodic idea.

Preserve:

- contour;
- note order;
- phrase spacing;
- key anchor candidates.

Use for:

- "this is what you sang" trust;
- debugging;
- low-intervention preview.

### 7.2 CorrectedMelody

Fix obvious musical errors while keeping the original phrase identity.

Typical operations:

- pitch-center stabilization;
- missed-target repair;
- de-jittering;
- phrase-aware timing cleanup.

Use for:

- default preview;
- accompaniment generation input.

### 7.3 MusicalMelody

The tasteful, listener-facing melody line.

Typical operations:

- stronger cadence shaping;
- duration rebalancing;
- beat placement cleanup;
- context-aware note relocation when the original placement is musically weak.

Use for:

- "pleasant" mode;
- save/export when the input quality is poor;
- refined accompaniment decisions.

### 7.4 Persist the melody choice

When Murmur decides which melody layer to use for generation, that choice
should be saved with the song as `sourceMelodyKind`.

This is not just analytics. It lets the product:

- explain later why a saved song sounds slightly more corrected or more musical;
- keep regenerate/edit flows consistent with the original save decision;
- compare trust-preserving output against taste-preserving output over time.

Saved-song edit flows should reopen the song with the same melody-choice intent
instead of silently collapsing everything back to a generic default.

Saved songs may also branch into a fresh set of vibe candidates, but those
variants should still inherit the original melody-choice stance rather than
pretending the song came from a brand-new neutral transcription.

The same stance should stay visible in Studio so downstream edits, restores,
and save decisions continue to respect whether the song is preserving intent,
repairing toward accuracy, or leaning toward musical sweetness.

Studio should also track a lightweight edit depth signal so Murmur can tell
the difference between a nearly untouched version, a lightly shaped version,
and one that has been substantially reworked after the original melody choice.

When a song has been substantially reworked, later variant generation should
bias toward the song's current vibe identity instead of treating the remix as
if it still lived only at the original raw melody branch point.

Saved songs should also carry lightweight branch lineage so the product can
distinguish an original save from later branches and keep those derivative
paths legible in future compare/history experiences.

## 8. Core pipeline

### 8.1 Input conditioning

Do the smallest useful amount of cleanup:

- mono normalization;
- fixed sample rate;
- head/tail silence trim;
- overload detection;
- light constant-noise suppression;
- low-voice / too-far-from-mic detection.

Do not over-process the voice before melody extraction.

### 7.2 Contour-first pitch analysis

Treat continuous F0 contour as the base truth, and discrete notes as a derived
representation.

Required stages:

1. voiced / unvoiced detection;
2. continuous contour extraction;
3. onset and proposal profiles;
4. note segmentation;
5. confidence rescoring across frames, notes, and phrases.

This is the main defense against:

- urgent short phrases;
- vibrato being split into fake notes;
- glide-heavy humming;
- users whose rhythm is correct but pitch is rough.

### 7.3 Confidence-driven correction

Only correct aggressively where confidence is low or the musical reading is
obviously broken.

High-confidence regions should move little.
Low-confidence regions can be repaired more strongly.

Important signals:

- note duration;
- local stability;
- beat strength;
- phrase position;
- tonal fit;
- onset clarity;
- agreement between contour and segmented note hypothesis.
- whether the contour profile looked more like glide, wobble, or urgent attack
  before note boundaries were committed.

### 7.4 Phrase and tonal polish

After note recovery, apply musical repair:

- phrase-aware quantization;
- rhythmic skeleton alignment for unstable interior notes;
- key / mode inference;
- cadence stabilization;
- duration redistribution;
- playable-range clamp for the selected lead instrument.

The product goal here is not "clean MIDI." It is "a melody that sounds like a
small song."

## 8. Correction rules

### 8.1 Rhythm correction

Rhythm correction should help a phrase stand up, not force everything to a
mechanical grid.

#### 7.1.a Rest completion

If the space between notes is too short but the phrase clearly wants a breath,
lengthen the gap.

#### 7.1.b Duration rebalance

If a structurally important note is too short, extend it. Nearby ornamental
fragments may be shortened or merged.

#### 7.1.c Urgent phrase smoothing

When the user sings in a rushed, fragmented way, prefer a cleaner rhythmic unit
over preserving every tiny notelet.

### 8.2 Pitch correction

Pitch repair should behave like a musical arranger, not a blind auto-tuner.

#### 7.2.a Stable-note light snap

Long, stable, high-confidence notes should only be lightly attracted toward the
nearest reasonable target.

#### 7.2.b Missed-target compensation

If the phrase clearly aims upward or downward but the sung pitch misses the
expected landing, repair toward the musically likely goal.

#### 7.2.c Misplaced-note relocation

If a pitch is plausible but lands on an awkward beat position, allow the note
to shift in time instead of forcing the pitch alone.

### 8.3 Musical priority order

When rules compete, favor:

1. phrase identity
2. tonal plausibility
3. strong-beat stability
4. local pitch correctness
5. ornament preservation

## 9. Special-case policy

### 9.1 Good rhythm, weak pitch

Trust the rhythmic skeleton and phrase targets. Repair pitch more strongly than
timing.

### 9.2 Good pitch, loose rhythm

Preserve pitch contour. Clean timing carefully, especially around anchors and
cadences.

### 9.3 Very rushed input

Use contour-first interpretation. Segment conservatively and merge fragments
when a cleaner phrase reading is obvious.

### 9.4 Unusual tonal material

Do not force every melody into a naive major/minor reading too early. Allow an
ambiguous reading until phrase-level evidence is strong enough.

### 9.5 Very poor takes

Escalate toward a more musical output:

- stronger scale attraction;
- stronger cadence repair;
- stronger duration cleanup;
- simpler accompaniment.

This is where "pleasant" may slightly outrank strict fidelity.

## 10. Accompaniment policy

The first accompaniment goal is not maximal arrangement complexity. It is a
great-sounding, supportive bed under the melody.

Short-term preference:

- piano;
- guitar;
- restrained synth pad;
- light bass and percussion where the phrase supports it.

The lead melody remains the product's emotional center. If the accompaniment is
weak, the user should still be impressed by the melodic line itself.

## 11. Platform boundaries

### 11.1 Web

Good for:

- capture;
- quality gating;
- quick local contour pass;
- fast preview;
- lightweight accompaniment.

Avoid making the browser the mandatory home of the heaviest inference path.

### 11.2 App

Best target for device mode:

- stronger local processing;
- better audio I/O control;
- cached assets and previews;
- privacy-sensitive local-first flows.

### 11.3 Mini-program

Not a priority for the core engine. Treat it as a lighter shell and avoid
binding v2 engine decisions to its constraints.

## 12. Guardrails

The v2 rewrite must not regress below the current product in these ways:

- no silent fallback from failed recording to demo melody;
- no heavier denoise that destroys melodic intent;
- no global hard snap that erases phrase feel;
- no arrangement layer that diverges from the corrected melody contract;
- no platform split that creates incompatible melody semantics.

## 13. Recommended implementation order

1. improve capture diagnostics and lightweight input conditioning;
2. formalize contour-first, confidence-scored pitch analysis;
3. separate `IntentMelody`, `CorrectedMelody`, and `MusicalMelody`;
4. upgrade phrase-aware rhythm and pitch correction;
5. improve accompaniment tone before adding more generative complexity;
6. support shared cloud/device execution behind the same melody contract.

## 14. External references

These references are useful for framing Murmur's direction, but Murmur should
not copy their product goal wholesale:

- Google Hum to Search: melody-search retrieval, useful as a contour-first
  product reference rather than a creation model.
- SoundHound / ACRCloud humming search: useful examples of user expectations
  around tolerant melody capture.
- Spotify Basic Pitch: useful note-event and pitch-bend thinking for preserving
  melodic shape.
- SwiftF0 / CREPE: useful monophonic F0 baselines.
- DeepFilterNet: useful as a lightweight, bounded denoise stage rather than a
  full vocal transformation layer.
