# Murmur Humming Research Landscape

Last updated: 2026-06-05

This note is the practical research map behind Murmur's humming engine work.
It is not a general MIR reading list. It is a filter for one product goal:

- keep the result recognizable as the user's melody idea;
- make the result sound musical enough to keep listening to.

## 1. Executive summary

The landscape splits into two different families:

1. **query-by-humming / song identification**
   strong at tolerant melody retrieval, weak as a direct creation engine.
2. **audio-to-pitch / audio-to-MIDI / pitch-correction**
   much closer to what Murmur actually needs.

The practical conclusion is:

- borrow **robustness** from song-ID systems;
- borrow **pitch/front-end and note proposals** from transcription systems;
- keep **melody repair, arrangement, and render taste** inside Murmur.

## 2. Product landscape

### 2.1 Google Hum to Search

Reference:

- <https://blog.google/products/search/hum-to-search>
- <https://research.google/blog/the-machine-learning-behind-hum-to-search/>

What it does well:

- turns humming into a melody representation that survives singer/timbre
  differences;
- solves "I know the tune but not the title" very well.

Why Murmur should not copy the objective directly:

- the objective is **identity retrieval**, not "preserve this singer's intended
  melody and make it into a song";
- it intentionally throws away a lot of performer-specific detail.

What to borrow:

- tolerant handling of noisy human humming;
- a strong separation between **melody representation** and downstream use.

### 2.2 SoundHound

Reference:

- <https://www.soundhound.com/soundhound>

What it signals:

- consumer sing/hum recognition is viable only when input quality and phrase
  length are decent;
- UX expectations are immediate, forgiving, and low-friction.

What to borrow:

- input-quality-aware UX;
- "give me something useful fast" interaction posture.

### 2.3 ACRCloud and the NetEase pattern

Reference:

- <https://docs.acrcloud.com/tutorials/recognize-music>
- <https://docs.acrcloud.com/reference/identification-api/metadata/humming>
- <https://www.acrcloud.cn/netease>
- <https://www.alibabacloud.com/blog/599784>

What this family is doing:

- audio fingerprinting for normal recognition;
- humming-specific identification as a separate tolerant path;
- NetEase's public-facing story suggests recognition and creation/scoring are
  different problem families, even if the product surface feels unified.

What to borrow:

- separate pipelines for **recognition** and **creative transformation**;
- unified UX, but not unified objective functions.

### 2.4 BandLab

Reference:

- <https://bandlabai.com/>
- <https://promo.bandlab.com/autopitch-free-pitch-correction>
- <https://blog.bandlab.com/autopitch-vocal-effects/>

What it does well:

- takes recorded audio into editable musical objects;
- combines pitch tools, MIDI editing, instruments, mixing, and mastering in one
  creator-facing loop;
- keeps the post-transcription world editable instead of black-box.

What to borrow:

- once Murmur has a corrected melody, keep the rest of the pipeline legible and
  editable;
- invest in sound sources, presets, and mix taste before chasing giant
  end-to-end audio generation.

### 2.5 Voloco / Auto-Tune family

Reference:

- <https://voloco.com/vocal-effects.html>
- <https://help.antarestech.com/hc/en-us/articles/41117209383956-Auto-Tune-Access-10-FAQ>

What this family proves:

- users do understand a spectrum between "natural correction" and "obvious
  effect";
- pitch repair controls can be productized as a small number of musical knobs.

What to borrow:

- the idea of a **single taste axis** is product-legible;
- Murmur should keep that axis soft and high-level, not expose a DAW panel on
  the front door.

## 3. Paper and open-source stack

### 3.1 SwiftF0

Reference:

- Repo: <https://github.com/lars76/swift_f0>
- Paper: <https://arxiv.org/abs/2508.18440>

Why it matters:

- very attractive CPU/runtime profile;
- returns continuous F0, timestamps, confidence, and voicing;
- already supports note segmentation utilities and client-side demo thinking.

Best use in Murmur:

- first-pass continuous F0 backbone;
- especially good for local/device mode and browser-adjacent experimentation.

### 3.2 CREPE

Reference:

- Repo: <https://github.com/marl/crepe>
- Paper: <https://arxiv.org/abs/1802.06182>

Why it matters:

- proven monophonic pitch tracker;
- a strong reference baseline for contour extraction under noise.

Best use in Murmur:

- benchmark/baseline against SwiftF0 and pYIN;
- good offline comparison oracle for difficult humming samples.

### 3.3 Basic Pitch

Reference:

- Engineering post: <https://engineering.atspotify.com/2022/06/meet-basic-pitch/>
- Repo: <https://github.com/spotify/basic-pitch>

Why it matters:

- lightweight audio-to-MIDI design;
- explicitly models onset, note, and pitch-bend behavior;
- much closer to "musical note proposal" than plain F0 trackers.

Best use in Murmur:

- not as the single truth source;
- as a **note proposal head** that sits next to continuous F0.

The healthy pattern is:

- SwiftF0 / CREPE = contour truth candidate;
- Basic Pitch = note segmentation and bend-aware proposal;
- Murmur melody-polisher = final arbiter.

### 3.4 DeepFilterNet

Reference:

- Repo: <https://github.com/Rikorose/DeepFilterNet>
- Paper: <https://arxiv.org/abs/2110.05588>

Why it matters:

- practical real-time speech enhancement;
- low-complexity framing is compatible with local preview and worker use.

Best use in Murmur:

- pre-clean only;
- never let denoise become a hidden melody rewrite stage.

### 3.5 DDSP / MIDI-DDSP

Reference:

- DDSP repo: <https://github.com/magenta/ddsp>
- DDSP paper: <https://openreview.net/pdf?id=B1x1ma4tDr>
- MIDI-DDSP: <https://github.com/magenta/midi-ddsp>

Why it matters:

- gives a route toward richer timbre and expression without abandoning
  structured musical control;
- useful for a later phase where Murmur wants "better sounding" to include more
  expressive render behavior.

Best use in Murmur:

- phase 2 or later;
- for timbre/render experimentation after melody confidence and arrangement
  quality are stable.

## 3.6 Public evaluation sets worth actually using

The strongest correction to our earlier research is this:

we should stop talking about datasets only as background reading and start
treating them as executable evaluation inputs.

The highest-value public sets are:

- `HumTrans`:
  closest public match to Murmur's humming-to-transcription task;
- `vocadito`:
  strong for note and F0 agreement on short monophonic singing;
- `DALI`:
  strong for note timing and phrase alignment;
- `MIR-QBSH`:
  useful to pressure-test rough humming robustness without inheriting
  retrieval as the product objective.

This is also why the manifest-based worker audit path matters: it is the bridge
between research assets and Murmur's real unattended regression loop.

## 4. What Murmur should copy vs. not copy

### Copy

- frame-level confidence and voicing outputs;
- separate contour extraction from note decisions;
- light denoise before pitch, not instead of pitch;
- editable MIDI/event-style downstream arrangement;
- a small number of musically meaningful user controls.

### Do not copy blindly

- retrieval embeddings as the main product objective;
- end-to-end black-box song generation for the core path;
- aggressive global quantization and key snapping;
- heavyweight cloud-only inference as a requirement for a basic preview.

## 5. Immediate engineering borrowing plan

### 5.1 Input layer

- keep fixed mono / sample-rate path;
- add recording quality checks before and after capture;
- keep DeepFilterNet optional and light.

### 5.2 Pitch layer

- keep current pYIN path as baseline fallback;
- evaluate SwiftF0 as the preferred fast contour detector;
- optionally run Basic Pitch server-side on selected takes to compare note
  segmentation quality.

### 5.3 Melody repair layer

- move toward explicit stages:
  - voiced/unvoiced
  - contour smoothing
  - note proposals
  - key/scale inference
  - cadence correction
  - confidence rescoring
- repair only low-confidence or musically implausible regions.

### 5.4 Render layer

- keep Murmur's arrangement pipeline controllable;
- improve instruments, presets, and mix chain before adding bigger generation
  systems.

## 6. Concrete next steps

1. Build a small humming eval set from Murmur takes:
   clean, noisy, rushed, off-key-but-rhythmic, and glide-heavy.
2. Compare `pYIN`, `SwiftF0`, and one `Basic Pitch`-assisted segmentation path
   on that eval set.
3. Promote the winning contour detector into the worker contract.
4. Keep provenance and repair-bias controls in quiet surfaces only:
   `Me!`, `Gallery`, and saved-song detail.
5. Defer DDSP-class timbre work until the melody front-end is stable.

## 7. Borrowing plan for Murmur code

The research worktree at `/Users/dujiayi/murmur-research` now contains cloned
reference repos for direct code inspection:

- `references/basic-pitch`
- `references/swift-f0`
- `references/crepe`
- `references/DeepFilterNet`
- `references/ddsp`

The implementation plan should be:

1. **Worker contract expansion**
   Extend the audio worker response so it can return:
   - continuous contour frames;
   - frame confidence;
   - voiced/unvoiced mask;
   - optional note proposals.
2. **Fast contour experiment**
   Compare current `pYIN` output against a `SwiftF0` path on the same Murmur
   humming samples.
3. **Note proposal experiment**
   Prototype a `Basic Pitch`-inspired proposal stage for segmentation and bend
   evidence, without letting it replace Murmur's final melody repair.
4. **Confidence-first repair**
   Move more of `src/modules/music/humming-engine.ts` toward explicit repair of
   low-confidence regions only.
5. **Render improvements stay downstream**
   Improve sound sources, presets, and mix taste before taking on heavier DDSP
   or full generative render work.

## 8. Bottom line

The most important research conclusion is simple:

Murmur should not become a generic "identify songs" product or a generic "one
click AI music" product.

It should become a **very disciplined humming-to-song engine**:

- better than query-by-humming at preserving melodic intent;
- better than generic pitch correction at sounding like a musical phrase;
- much lighter and more controllable than black-box song generation.
