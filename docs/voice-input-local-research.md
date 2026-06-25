# Voice Input Local Recognition KGS

Status: rigorous implementation plan, 2026-06-26.

KGS here means a repository-local knowledge and gate specification: the evidence,
decision rules, interfaces, rollout gates, and test criteria that must be true
before Murmur routes a recording into the Voice branch.

This document supersedes the earlier "OpenAI speech-to-text first" assumption.
Recognition for Voice-aware capture must be local or self-hosted. MiniMax remains
the downstream music generator after Murmur has already decided that the input is
lyrical Voice.

## Decision

Use a server-side speech worker as the authoritative v1 recognizer:

```text
recording
  -> browser capture prep
  -> POST /api/capture/analyze
  -> local speech worker: VAD + ASR + audio diagnostics
  -> Murmur router: Hum | Voice
  -> Hum: existing audio-engine melody transcription
  -> Voice: lyrics + style prompt -> MiniMax Music
```

Default model strategy:

1. Prefer **SenseVoice-first** for Voice v1 if the deployed model artifact has a
   production-acceptable license record and passes Murmur's own sample acceptance.
2. Keep **faster-whisper** as the mandatory baseline and fallback provider because
   its code and common model artifacts are MIT, its diagnostics are mature, and it
   gives Murmur a stable comparison point.
3. Use **sherpa-onnx** or the **SenseVoice GGUF/llama.cpp runtime** as serious
   deployment candidates for SenseVoice, depending on which runtime gives better
   structured diagnostics and operational simplicity.
4. Do not use external ASR APIs for routing. Do not make browser ASR
   authoritative in v1.

The practical stance is: **SenseVoice can become the default only after artifact
license review and corpus acceptance.** Until then, implement the provider
contract so SenseVoice, faster-whisper, and later sherpa-onnx/whisper.cpp are
swappable without changing `/api/capture/analyze`.

## Why SenseVoice Is Attractive

SenseVoice is a strong fit for Murmur's Voice branch:

- It targets multilingual speech understanding: ASR, language identification,
  emotion recognition, and audio event detection.
- The FunAudioLLM paper says SenseVoice-Small provides low-latency ASR for 5
  languages; the released README/model card list Mandarin, Cantonese, English,
  Japanese, and Korean support.
- The official README says it was trained on more than 400,000 hours and reports
  advantages over Whisper on Chinese/Cantonese benchmarks.
- It is non-autoregressive / CTC-style for SenseVoiceSmall, which reduces the
  Whisper-style repeated-text and long-context failure profile.
- Its event tags such as Speech/BGM/Laughter/Cough can be useful for rejecting
  noisy non-lyrical inputs before Voice generation.
- The 2026 GGUF runtime claims self-contained CPU deployment with built-in FSMN
  VAD and reports roughly 8 percent Mandarin CER on its benchmark, substantially
  better than whisper.cpp on that Chinese CPU benchmark.

This makes SenseVoice especially compelling for Chinese lyrics, where Murmur
needs better support than a generic multilingual Whisper model.

## License And Artifact Gate

Do not treat "SenseVoice" as one license. The runtime, code, original model
weights, and converted artifacts may have different terms.

Observed sources:

- `modelscope/FunASR` code: MIT.
- `FunAudioLLM/SenseVoice` repository `LICENSE`: redirects to the FunASR license
  section, not a simple model-weight license by itself.
- `FunAudioLLM/SenseVoiceSmall` Hugging Face metadata: `license: other`, with
  `license_link` pointing to FunASR `MODEL_LICENSE`.
- FunASR `MODEL_LICENSE`: custom terms, including attribution, termination,
  update clauses, and "reference and learning purposes" language. This is not an
  OSI-standard permissive model license.
- `FunAudioLLM/SenseVoiceSmall-GGUF` Hugging Face metadata: `license:
  apache-2.0`, with GGUF artifacts and a CPU runtime story.

Production rule:

```text
Murmur may use SenseVoice as the default production recognizer only if the exact
model artifact, runtime, and distribution path are pinned with:

- artifact id and SHA/hash;
- source URL;
- license identifier and license text snapshot;
- confirmation that the license allows Murmur's intended commercial deployment;
- model-card caveats copied into release notes;
- acceptance report on Murmur's own corpus.
```

If that cannot be established, run SenseVoice only in local evaluation or shadow
mode and keep faster-whisper as the production recognizer.

## Research Context

Murmur is not building general dictation. It is routing a short musical recording
into one of two product experiences:

- **Hum**: user cares about melody contour; lyrics may not exist.
- **Voice**: user sang or spoke meaningful lyrics; Murmur keeps lyrics and style
  intent, but Voice v1 does not preserve the sung melody.

Relevant lessons from external work:

- Query-by-humming and Google Hum to Search style systems solve melody matching
  with melody embeddings, not lyric ASR. That supports keeping Hum as a separate
  melody-first path.
- ASR systems such as Whisper are strong baselines, but model documentation and
  follow-up studies warn about hallucination and repeated text, especially when
  the input is noisy or contains little speech.
- Singing lyrics recognition is harder than speech recognition because singing
  stretches vowels, weakens consonants, changes prosody, and often includes
  background music.
- VAD/SAD is not a lyrics detector. It can say "speech-like or vocal activity is
  present", but it cannot distinguish pure hum, `la la`, singing, and lyrical
  content by itself.

Therefore Murmur must use a conservative multi-signal router, not a naked ASR
transcript.

## Current Murmur Integration

The current branch already has the right product boundary:

- Live recordings enter `POST /api/capture/analyze`.
- Voice is additive: disabled, unconfigured, failed, or ambiguous recognition
  falls back to Hum.
- Hum still uses the existing audio worker and billing semantics.
- Voice generation is downstream: lyrics plus style prompt go to MiniMax, and
  the generated MP3 is stored in Murmur object storage.

OpenAI coupling removed in the first local-worker pass:

- `src/lib/platform/speech-recognition.ts` now creates a local speech worker
  provider when `MURMUR_VOICE_INPUT_ENABLED=1` and `SPEECH_WORKER_URL` is
  present.
- `.env.example`, `scripts/env-audit.ts`, `README.md`, and
  `docs/provider-strategy.md` now point Voice capture at `SPEECH_WORKER_*`
  rather than `OPENAI_API_KEY`.
- Tests use local provider labels such as
  `local:sensevoice:SenseVoiceSmall-GGUF`.

The provider interface is preserved, with the default recognition provider now
pointing at a local speech worker.

## Provider Matrix

| Provider | Role | Strength | Risk | Decision |
|---|---|---|---|---|
| SenseVoiceSmall via FunASR Python/ONNX | Candidate default | Chinese quality, LID, event/emotion tags, low latency claims | Original HF artifact is `license: other`; heavier dependency story | Use in eval/shadow until license and ops pass |
| SenseVoiceSmall-GGUF via FunASR llama.cpp runtime | Candidate default | CPU/edge binary, built-in FSMN-VAD, HF metadata says Apache-2.0, strong Chinese CPU benchmark | Newer runtime, less TypeScript/Python adapter maturity, diagnostics may need wrapper work | Strong SenseVoice production candidate if artifact license is confirmed |
| sherpa-onnx SenseVoice | Candidate default/phase 2 | Offline ASR/VAD, C++/Python/JS/mobile/WASM reach, Apache-2.0 runtime | Model artifacts may have separate licenses; diagnostics vary by model | Good long-term runtime if artifact licensing is pinned |
| faster-whisper | Baseline/fallback | MIT ecosystem, CTranslate2, CPU/GPU/int8, mature segment diagnostics | Whisper can hallucinate on noise/hum; Chinese lyrics may lag SenseVoice | Mandatory baseline and safe fallback |
| whisper.cpp | Native fallback | MIT, quantization, Metal/Core ML/CUDA/OpenVINO/Vulkan, server binary | Structured diagnostics less convenient | Good native/offline fallback |
| Silero VAD | VAD gate | MIT, ONNX, fast CPU, robust multilingual/noise claims | VAD only | Use as first-stage gate unless SenseVoice runtime's FSMN-VAD wins |
| WebRTC VAD | Low-level fallback | Tiny, mature | Boolean output, weak diagnostics | Not enough for routing |
| Browser Whisper/Transformers.js | UX/lab only | Runs in browser via WASM/WebGPU | Large model, cold start, mobile/Safari variance | Not authoritative in v1 |

## Worker Architecture

Create a sibling worker, not a bloated default audio worker:

```text
workers/audio-engine   -> Hum pitch/melody extraction
workers/speech-engine  -> VAD, ASR, voice routing diagnostics
```

Reason:

- ASR dependencies, model weights, memory use, and cold start should not degrade
  the demo-critical Hum path.
- SenseVoice/faster-whisper can be benchmarked, rolled back, and scaled
  independently.
- The Next.js route can keep the same `SpeechRecognitionProvider` contract while
  the worker implementation changes.

Suggested worker route:

```http
POST /analyze-speech
Authorization: Bearer <SPEECH_WORKER_TOKEN>
X-Request-Id: <id>
multipart/form-data audio=<file>
```

Suggested worker response:

```ts
{
  provider: "local:sensevoice:<artifact>" | "local:faster-whisper:<model>";
  text: string;
  language: "zh" | "en" | "unknown";
  confidence: number;
  segments: Array<{
    text: string;
    start: number;
    end: number;
    confidence?: number;
    avgLogprob?: number;
    noSpeechProb?: number;
    compressionRatio?: number;
    words?: Array<{ word: string; start?: number; end?: number; probability?: number }>;
  }>;
  vad: {
    provider: "silero" | "fsmn-vad" | "webrtc" | "none";
    speechDurationMs: number;
    speechRatio: number;
    segmentCount: number;
    maxSpeechSegmentMs: number;
    meanSpeechProbability?: number;
    onsetMs?: number;
    offsetMs?: number;
  };
  audio: {
    durationMs: number;
    rmsDbfs?: number;
    peakDbfs?: number;
    snr?: number;
    clippingRatio?: number;
  };
  asrDiagnostics: {
    model: string;
    artifact?: string;
    artifactSha?: string;
    license?: string;
    runtime: "funasr" | "funasr-gguf" | "sherpa-onnx" | "faster-whisper" | "whisper.cpp";
    device: "cpu" | "cuda" | "metal" | "unknown";
    computeType?: string;
    languageProbability?: number;
    event?: "speech" | "bgm" | "laughter" | "cough" | "breath" | "unknown";
    emotion?: string;
    avgLogprob?: number;
    noSpeechProb?: number;
    compressionRatio?: number;
    decodeMs: number;
    totalMs: number;
  };
}
```

Environment:

```env
MURMUR_VOICE_INPUT_ENABLED=0
SPEECH_WORKER_URL=http://127.0.0.1:8003
SPEECH_WORKER_TOKEN=
SPEECH_RECOGNITION_PROVIDER=worker
SPEECH_WORKER_TIMEOUT_MS=8000
SPEECH_WORKER_PRIMARY_PROVIDER=sensevoice
SPEECH_WORKER_FALLBACK_PROVIDER=faster-whisper
SPEECH_WORKER_REQUIRE_ARTIFACT_LICENSE=1
SPEECH_WORKER_MODEL_ARTIFACT=
SPEECH_WORKER_MODEL_SHA=
```

Production env audit should require `SPEECH_WORKER_URL`,
`SPEECH_WORKER_TOKEN`, `SPEECH_WORKER_MODEL_ARTIFACT`, and
`SPEECH_WORKER_MODEL_SHA` when voice input is enabled. It should not require
`OPENAI_API_KEY` for recognition.

## Router Algorithm

`voice` requires independent positive evidence. Missing evidence, disagreement,
or low confidence returns Hum.

1. Browser prepares audio:
   - decode when possible;
   - mix to mono;
   - trim obvious head/tail silence with padding;
   - retain original blob fallback.
2. Worker decodes and normalizes to 16 kHz mono PCM.
3. Worker computes audio quality:
   - duration;
   - RMS/peak;
   - clipping ratio;
   - SNR/noise floor estimate.
4. Worker runs VAD:
   - speech/vocal segment duration;
   - speech ratio;
   - fragmentation;
   - onset/offset.
5. Early Hum fallback if:
   - too short;
   - too quiet;
   - too clipped;
   - too low SNR;
   - VAD duration too low;
   - VAD fragmentation too high.
6. Worker runs ASR on VAD-positive windows.
7. Murmur validates transcript:
   - language is zh/en or supported code-switch;
   - meaningful character/word count is sufficient;
   - filler/hum syllable ratio is low;
   - repeated text ratio is low;
   - provider diagnostics pass.
8. Murmur optionally uses event tags:
   - `bgm`, `laughter`, `cough`, `breath`, or `nospeech` can force Hum or retry
     unless there is strong transcript evidence.
9. Return Voice only if acoustic, VAD, ASR, and text gates all pass.

Initial thresholds for local evaluation:

```text
min_audio_ms = 1800
min_vad_speech_ms = 900
min_vad_speech_ratio = 0.18
max_vad_fragmentation = 6 segments per 10 seconds
min_snr_db = 6
max_clipping_ratio = 0.02
min_language_probability = 0.55
min_zh_chars = 4
min_en_words = 3
max_hum_syllable_ratio = 0.45
max_repeated_text_ratio = 0.5

# Whisper/faster-whisper only
max_no_speech_prob = 0.45
min_avg_logprob = -0.85
max_compression_ratio = 2.4
```

These are starting values. Threshold changes must come from corpus reports, not
from anecdotal single clips.

## Hum, Speech, And Voice Taxonomy

Do not expose every internal class in the product response yet, but measure them
internally:

- `hum`: melody-only vocalization, whistle, or non-lexical singing.
- `vocalise`: `la/na/hmm/ah/oh/啦/啊/嗯` style syllables; product default is Hum.
- `singing_lyrics`: sung lyrics with meaningful zh/en words.
- `spoken_lyrics`: spoken words that may be usable as lyrics, but v1 should be
  conservative and can default to Voice only if the user intentionally used the
  Voice flow later.
- `noise`: silence, environment, pure accompaniment, laughter/cough/breath.
- `ambiguous`: not enough evidence; product default is Hum or retry prompt.

`POST /api/capture/analyze` can still return only:

```ts
{ kind: "hum"; transcription: TranscriptionResult }
{ kind: "voice"; lyrics: string; language; confidence; diagnostics }
```

The richer taxonomy belongs in diagnostics and evaluation reports.

## Frontend Role

Frontend v1 remains an assistive layer:

- Web Audio decode/mix/trim.
- User-facing hints for too short, too quiet, or clipped audio.
- Optional browser VAD for live feedback and obvious silence rejection.

Frontend v1 is not the authoritative recognizer:

- browser ASR model files are large;
- WebGPU availability varies across mobile browsers;
- cold start and battery cost conflict with Murmur's short-capture experience;
- backend and frontend thresholds would drift.

Browser ASR belongs in a future offline/native mode or debug lab.

## KGS Artifacts To Land In The Repo

The implementation should add durable artifacts, not only runtime code:

```text
docs/voice-input-local-research.md              # this decision record
docs/voice-input-acceptance.md                  # corpus/eval protocol and latest report
workers/speech-engine/README.md                 # worker runtime and model artifacts
workers/speech-engine/MODELS.md                 # artifact ids, hashes, licenses
workers/speech-engine/main.py or server wrapper # /analyze-speech
workers/speech-engine/tools/eval_voice_input.py # confusion matrix + CER/WER + latency
workers/speech-engine/tools/manifest.example.json
src/lib/platform/speech-recognition.ts          # local worker adapter + router gates
src/lib/platform/speech-recognition.test.ts     # routing unit tests
```

Do not store user audio in the repo. Any consented local corpus should live in an
ignored local folder with a manifest format that can be shared without media.

## Acceptance Corpus

Before enabling `MURMUR_VOICE_INPUT_ENABLED=1`, collect consented samples:

- 100 pure hum or whistle clips;
- 80 nonsense vocalise clips: `la/na/hmm/ah/ooh`, Chinese `啦/啊/嗯`;
- 100 Chinese lyric singing clips;
- 80 English lyric singing clips;
- 40 spoken lyric/instruction clips;
- 50 noisy, quiet, far-mic, clipped, or background-music clips;
- 30 silence/environment/noise/pure accompaniment clips;
- optional mixed zh/en and accented samples.

Minimum report:

- confusion matrix by taxonomy;
- Hum false Voice examples;
- noise false Voice examples;
- accepted Voice CER/WER;
- rejected Voice CER/WER;
- provider latency P50/P95;
- route reason distribution;
- per-provider comparison: SenseVoice vs faster-whisper;
- top 20 failure clips with diagnostics.

Minimum v1 gate:

- pure Hum and nonsense vocalise route to Hum at least 97%;
- silence/pure noise accepted Voice at most 1%;
- all non-lyrical negatives accepted Voice at most 3%;
- clear Chinese/English lyric singing accepted Voice at least 85%;
- accepted Chinese lyric CER at most 30%;
- accepted English lyric WER at most 40%;
- ambiguous/retry bucket at most 15%;
- 10 second speech analysis P95 at most 5 seconds on target hardware;
- 15 second speech analysis P95 at most 8 seconds on target hardware;
- every decision logs route reason and diagnostics.

SenseVoice can become default only if it beats faster-whisper on at least one of:

- Chinese lyric CER by 20% relative or more at similar false Voice rate;
- latency by 30% relative or more at similar accuracy;
- noise/event rejection with no worse lyric recall;

and does not regress English Voice acceptance by more than 5% relative.

## Tests

Unit tests:

- pure Hum text and VAD diagnostics return Hum;
- nonsense syllables return Hum;
- Chinese lyrics return Voice only when VAD/audio gates pass;
- English lyrics return Voice only when VAD/audio gates pass;
- low SNR returns Hum even with ASR text;
- high repeated text returns Hum;
- provider timeout returns Hum fallback and logs warning;
- worker invalid response returns Hum fallback;
- artifact license missing blocks production env audit.

Worker tests:

- auth required outside loopback/dev;
- max audio size enforced;
- decode failures return typed error;
- VAD no speech returns no-ASR diagnostics;
- SenseVoice/faster-whisper provider output normalizes to the same contract;
- model artifact id/hash/license are present in diagnostics.

Integration tests:

- `/api/capture/analyze` does not regress existing Hum behavior;
- voice provider failure does not spend Hum notes until Hum worker starts;
- Voice path still creates MiniMax version and saves lyrics/mp3Url;
- saved Voice detail/share playback uses stable storage URL.

Eval tests:

- manifest parser validates labels and consent metadata;
- CER/WER calculation handles zh/en normalization;
- report fails CI-style gate when false Voice exceeds threshold.

## Rollout

1. **Research mode**: local worker runs manually on 20-30 clips. No UI changes.
2. **Shadow mode**: production/staging logs speech worker decision but route still
   follows current Hum fallback unless manually enabled.
3. **Internal mode**: enabled for team/demo accounts behind
   `MURMUR_VOICE_INPUT_ENABLED=1`.
4. **Limited production**: enable for a small percentage after acceptance report.
5. **Default production**: only after artifact license, corpus gate, latency, and
   support flows are all green.

Rollback must be one env change:

```env
MURMUR_VOICE_INPUT_ENABLED=0
```

or:

```env
SPEECH_WORKER_PRIMARY_PROVIDER=faster-whisper
```

## Open Follow-Ups

The current branch is a strong architectural cut, but it is not the final launch
configuration yet. Remaining work:

- wire a real baseline provider into `workers/speech-engine` so the worker is
  doing actual ASR instead of only contract shaping;
- pin the exact SenseVoice artifact/license combination before any production
default change;
- add the corpus acceptance harness and keep the voice gate in shadow until it
passes;
- decide whether provider rotation needs a true API pool, or whether a simple
  primary/fallback pair is enough for v1;
- add one fully exercised end-to-end smoke that records audio, routes Voice,
  generates MiniMax audio, saves the song, and reopens playback in the browser.
- `bun run smoke:voice` now exists as the smallest code-path smoke for that
  chain; it should be kept green alongside the API and worker tests.

For now, provider selection is env-driven and single-route. There is no general
purpose API pool abstraction in the repo yet.

## Launch Readiness Checklist

Before turning `MURMUR_VOICE_INPUT_ENABLED=1` on for any broader audience, all
of these should be true:

- speech worker has a real baseline ASR provider and emits stable diagnostics;
- `faster-whisper`/SenseVoice comparison report is checked in;
- production artifact/license choice is pinned in `workers/speech-engine/MODELS.md`;
- one end-to-end smoke covers Hum, Voice, save, and reopen;
- the voice route stays conservative on noisy / ambiguous / nonsense clips;
- docs in README, provider strategy, and this file agree on the startup path;
- there is a single operator command for local dev that starts audio, speech,
  music, and Next.js together.

## Implementation Phases

Phase 1: provider contract.

- Keep the local worker provider as the default recognition adapter.
- Add `SPEECH_WORKER_*` env and env audit.
- Preserve Hum fallback on all recognition errors.
- Extend diagnostics to include VAD/audio/model artifact fields.

Phase 2: worker skeleton.

- Add `workers/speech-engine`.
- Implement FastAPI auth, upload validation, decode, audio stats, and a stub
  provider with contract tests.
- Add README and `MODELS.md`.

Phase 3: faster-whisper baseline.

- Implement faster-whisper provider for baseline comparison.
- Expose segment diagnostics such as language probability, no-speech probability,
  avg logprob, and compression ratio.
- Add negative routing tests.

Phase 4: SenseVoice provider.

- Implement SenseVoice provider through the selected runtime:
  - preferred candidate: GGUF/llama.cpp or sherpa-onnx if license/artifact story
    is clean and diagnostics can be wrapped;
  - alternate: FunASR Python/ONNX in eval/shadow mode.
- Normalize language, event, emotion, text, and timing into the common contract.
- Pin artifact and license metadata.

Phase 5: evaluation harness.

- Add manifest format, CER/WER, confusion matrix, latency report, and markdown
  report generation.
- Run SenseVoice vs faster-whisper on Murmur corpus.
- Promote default provider only after gate pass.

Phase 6: frontend assist.

- Add quality hints and optional browser VAD live feedback.
- Keep backend authoritative.

## Source Index

Primary:

- FunAudioLLM paper: <https://arxiv.org/abs/2407.04051>
- SenseVoice GitHub: <https://github.com/FunAudioLLM/SenseVoice>
- SenseVoiceSmall model card:
  <https://huggingface.co/FunAudioLLM/SenseVoiceSmall>
- SenseVoiceSmall-GGUF model card:
  <https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF>
- FunASR model license:
  <https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE>
- FunASR llama.cpp runtime:
  <https://github.com/FunAudioLLM/SenseVoice/tree/main/runtime/llama.cpp>
- FunASR GGUF benchmarks:
  <https://github.com/FunAudioLLM/SenseVoice/blob/main/runtime/llama.cpp/BENCHMARKS.md>

Baseline/fallback:

- faster-whisper: <https://github.com/SYSTRAN/faster-whisper>
- faster-whisper transcription diagnostics:
  <https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/faster_whisper/transcribe.py>
- Whisper paper: <https://arxiv.org/abs/2212.04356>
- Whisper model card: <https://github.com/openai/whisper/blob/main/model-card.md>
- whisper.cpp: <https://github.com/ggml-org/whisper.cpp>

VAD/runtime:

- Silero VAD: <https://github.com/snakers4/silero-vad>
- sherpa-onnx: <https://github.com/k2-fsa/sherpa-onnx>
- sherpa-onnx SenseVoice docs:
  <https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html>
- Transformers.js: <https://github.com/huggingface/transformers.js>

Product/research context:

- Google Hum to Search:
  <https://research.google/blog/the-machine-learning-behind-hum-to-search/>
- Query-by-humming TVR paper: <https://arxiv.org/abs/2302.04577>
- CHAD/ISMIR query-by-humming work: <https://arxiv.org/abs/2312.01092>
- Careless Whisper hallucination study: <https://arxiv.org/abs/2402.08021>
- Whisper non-speech hallucination study:
  <https://arxiv.org/html/2501.11378v1>
