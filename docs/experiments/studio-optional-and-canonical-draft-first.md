# Creation Journey Experiments

Status: experiment design; implementation disabled<br>
Owner: product engineering<br>
Last verified: 2026-07-18

This document defines two independent experiments. The assignment helper is
implemented, but no screen, navigation, save route, or visual treatment reads
the assignments yet. The current `Vibe -> Studio -> Name -> Song` journey is
therefore unchanged.

## Decision boundary

The product question is not whether fewer screens are always better. It is
whether Murmur can secure the user's chosen musical result sooner while
preserving creative agency and playback fidelity.

Run the experiments separately. Do not combine both treatments in the first
read: a faster save caused by one treatment must not be attributed to the
other.

## Experiment A: Studio optional

**Hypothesis:** after choosing a ready take, offering a clear primary path to
name/save and a secondary path to Studio will improve completed songs and
reduce time-to-save without reducing meaningful Studio use or later edits.

Control keeps the current route to Studio. Treatment may present two commands
after Pick:

- primary: finish and name the selected take;
- secondary: refine in Studio.

The treatment must not call Studio “unnecessary” or hide it. It must preserve
the selected take's exact audio and must not add a new interstitial screen.

**Primary metric:** `song_persisted / vibe_selected` within 30 minutes.

**Secondary metrics:** median and P95 selection-to-persist time, voluntary
Studio entry, Studio edit completion, later edit/remix, and share creation.

**Guardrails:** no regression beyond the agreed error margin in selected-take
playback fidelity, save failure, incomplete-song creation, duplicate billing,
seven-day deletion, or support events. Accessibility and mobile completion are
segmented before promotion.

## Experiment B: canonical draft first

**Hypothesis:** persisting the canonical editable song and provenance before
slow encode/upload work will reduce perceived save time and lost work without
increasing broken or permanently incomplete songs.

Control keeps the current render-then-create sequence. Treatment should:

1. transactionally create an idempotent song record in `processing` state;
2. preserve melody, arrangement, selected generation provenance, and stable
   artifact identity;
3. return the durable song id without waiting for encode/upload;
4. complete audio materialization through recoverable work;
5. make Song honest about processing, retry, and terminal failure states.

This is not permission to save a lossy reconstruction. If the selected exact
artifact is not durably addressable, the treatment is ineligible.

**Primary metric:** `song_opened / save_started` within 30 seconds.

**Secondary metrics:** save-to-song latency, recovery after refresh or tab
close, audio-ready latency, retries, and successful share/export.

**Guardrails:** no regression in exact selected-audio fidelity, permanently
incomplete songs after ten minutes, orphan object rate, duplicate song rate,
billing settlement, public playback, or delete semantics.

## Assignment contract

Use `currentFlowId` as the assignment unit. It keeps one creation internally
consistent while allowing a returning person to see a later experiment. Never
use a random value created during render.

The helper lives at `src/lib/experiments/creation-journey.ts` and defaults to
control. Supported public flag values are:

| Value | Meaning |
| --- | --- |
| unset / `off` / invalid | disabled; current behavior |
| `experiment` | enroll all eligible flows, stable 50/50 split |
| `experiment:10` | enroll 10% of eligible flows, stable 50/50 split |
| `control` | force control for QA only |
| `treatment` | force treatment for QA only |

Flags:

- `NEXT_PUBLIC_MURMUR_EXPERIMENT_STUDIO_OPTIONAL`
- `NEXT_PUBLIC_MURMUR_EXPERIMENT_CANONICAL_DRAFT_FIRST`

Forced values are diagnostic modes and must be excluded from experiment
analysis. An absent `currentFlowId` is ineligible and stays on control.

## Event contract

Do not emit exposure merely because a flag was evaluated. Emit it once when a
user first encounters behavior that differs by variant:

```text
experiment_exposed
  experiment
  variant
  flow_id
  release_sha

vibe_selected
first_clip_played
studio_entered
studio_edit_applied
save_started
canonical_draft_persisted
audio_materialization_started
audio_materialization_completed
song_opened
share_created
export_completed
creation_error
```

Every outcome carries `flow_id`, experiment assignments, release SHA, and
elapsed time from the preceding product milestone. Do not send raw audio,
prompts, song titles, or user identifiers as experiment properties.

## Rollout and rollback

1. Ship instrumentation and validate event joins before enabling treatment.
2. Run forced control and treatment in local/preview golden paths.
3. Start each experiment independently at 5%; inspect guardrails after at
   least one full worker cold-start and failure window.
4. Move to 25%, then 50% enrollment only after operational review. Do not use
   sample size alone to waive a guardrail.
5. Promote only with a predeclared analysis window and practical effect size;
   novelty and repeated peeking are not evidence.

Rollback is setting the relevant flag to `off` and redeploying the exact known
good release. Because disabled assignment is control and no persisted schema is
interpreted by the helper, rollback does not require data repair. The canonical
draft treatment must additionally retain a forward-compatible reader and a
reconciler until all treatment records reach a terminal state.

## Preconditions before UI connection

- durable experiment events exist outside process memory;
- one browser golden path covers each forced variant;
- exact selected-artifact identity survives refresh;
- canonical draft state and idempotency are represented in the database;
- Song has tested `processing`, `ready`, retryable failure, and terminal failure
  contracts;
- product and design approve the two-command hierarchy on mobile and desktop;
- privacy documentation covers the event properties.

Until these conditions are met, keep both flags off and do not import the
helper into a screen.
