# Testing Strategy

Historical note: this document started as the full v2 target state. The current
repo has implemented a meaningful subset of it already
(`bun test`, `bun run test:audio`, `bun run smoke:local`,
`bun run smoke:pages`, `bash scripts/ci-local-stack-smoke.sh`,
`bun run build:audit`), but it has not yet landed the Playwright-based browser
e2e lane described below.

This document defines the testing bar and the layered approach that gets Murmur
there without turning every PR into a test sprint.

It is written so Codex can author the **first** test in each layer
without re-deciding fixture conventions, naming, or pass/fail
philosophy.

---

## 1. The bar

| Layer | What | Where | When |
|---|---|---|---|
| **Unit** | Pure functions in `packages/murmur-core` | colocated `*.test.ts` | every PR touching the package |
| **Integration (API)** | Next.js route handlers + DB | colocated route `*.test.ts` today; future harness may use `src/tests/api/` | every PR touching a route |
| **Golden master (music)** | Same melody in → same arrangement out, byte-equivalent | colocated `*.test.ts` today; larger fixtures may use `src/tests/music/` | every PR touching arrangement / engine |
| **Audio worker** | Python worker behavior | `workers/audio-engine/tests/` | every PR touching the worker |
| **E2E** | Playwright web smoke; Capacitor smoke when that shell exists | `src/tests/e2e/` or a future app-local test folder | nightly + before release |
| **Manual** | What survives only the human eye (UI feel, audio musicality) | doc'd in PR | when relevant |

Required to merge: unit + integration + golden master pass; e2e
informational unless it gates a release.

## 1.1 What exists today

Current shipped verification layers:

- **Bun unit / integration-leaning tests** via `bun test`
- **Python worker tests** via `bun run test:audio`
- **API / stack smoke** via `bun run smoke:local`
- **Primary page-shell smoke** via `bun run smoke:pages`
- **Built-app + live-worker smoke** via
  `bash scripts/ci-local-stack-smoke.sh`
- **Build-warning governance** via `bun run build:audit`

That means Murmur is no longer starting from "zero tests," but it is also not
yet at the final multi-layer target described in the rest of this document.

---

## 2. Stack pick

- **Runner: `bun test`.** Already present, fastest, zero-config.
- **Assertion: `bun:test` built-ins** (it ships Jest-ish APIs). Avoid
  Vitest unless we hit a hard wall.
- **DB: ephemeral Postgres** via `testcontainers` for integration, or a
  per-test schema on a shared DB in CI. Codex picks the lightest path.
- **HTTP: Next.js `NextRequest` in-process** for routes; do not stand
  up a real server unless e2e.
- **E2E: Playwright** for Web; `appium` or `WebdriverIO` for Capacitor
  smoke; Taro has its own simulator harness (postpone until MP ships).

---

## 3. Test conventions

### 3.1 Naming + location

- `<name>.test.ts` next to the source file for pure unit tests.
- Route, integration-leaning, and golden-master tests are colocated today.
  Larger harnesses may live under `src/tests/<kind>/` once they exist.
- Audio worker tests live under
  `workers/audio-engine/tests/test_<unit>.py`.

### 3.2 What we name

- `describe("polishMelody", ...)` — the symbol being tested.
- `it("snaps off-key notes to the inferred scale", ...)` — the property
  the test asserts. Not "works correctly," not "case 1."
- Failure messages name the invariant: `expect(notes[3].pitch).toBe(62
  /* in-key D */)`.

### 3.3 Determinism

- Tests **must not** depend on `Date.now()`, `Math.random()`, or
  network. Inject these where they appear.
- Seeded RNG is supplied via `seededRandom(seed)` from
  `src/lib/utils/seeded-random.ts` or another explicit injected source.
- Tests that need a current time use `vi.setSystemTime` / `bun test`'s
  clock — never wall clock.

### 3.4 Speed budgets

- Unit suite: < 2 s on commodity hardware.
- Integration suite: < 30 s.
- Golden master: < 15 s.
- E2E: < 5 min for the smoke set; nightly full run < 30 min.

Slow tests are the first thing to drop in priority order; the bar is
"useful + fast" not "complete + slow."

---

## 4. Unit layer

What we test in `packages/murmur-core`:

- **Polisher**: scale fit, quantize, cadence stabilization, instrument
  range clamp.
- **Arrangement engines**: deterministic output for a fixed seed.
- **EditToken `applyEdit`**: every token returns a valid
  `ArrangementState`; specific assertions on the tokens that change
  intensity (`warmer`, `less_drums`, etc.).
- **Entitlements**: `resolveEntitlement(user, balance)` returns
  expected flags for free / guest / premium and zero / positive
  balances.
- **Cost table**: every action has a cost.
- **Sku / region selection**: returns the right SKU list per region.

What we **don't** unit-test in `murmur-core`:

- Things that need a DOM. They live in `src/`.
- Things that need network. Those are integration.

### Example skeleton

```ts
// packages/murmur-core/src/audio/melody-polisher.test.ts
import { describe, it, expect } from "bun:test";
import { polishMelody } from "./melody-polisher";
import { offKeyHum } from "./__fixtures__/off-key-hum.json";

describe("polishMelody", () => {
  it("snaps notes 0–7 to the inferred D minor scale", () => {
    const result = polishMelody(offKeyHum);
    expect(result.key).toBe("D");
    expect(result.scale).toBe("minor");
    for (const n of result.notes.slice(0, 8)) {
      expect(D_MINOR_PCS.has(n.pitch % 12)).toBe(true);
    }
  });
});
```

---

## 5. Integration / API layer

Every route in `src/app/api/` gets at least one happy-path
and one error-path test.

### 5.1 Setup

A `tests/api/setup.ts` provides:

```ts
function freshDb(): Promise<DbHandle>             // truncates all tables, seeds users
function fakeAuth(userId: string): Headers        // builds a valid Bearer header
function call(req: NextRequest): Promise<Response> // dispatches into the route handler
```

`freshDb` uses a per-test schema on a shared Postgres in CI.

### 5.2 Per-route coverage

| Route | Required cases |
|---|---|
| `POST /api/transcribe` | (a) happy path returns ScoredMelody; (b) 402 when balance < cost; (c) 422 when audio is silence; (d) 429 when rate-limited |
| `POST /api/strummer/edit` | (a) returns valid tokens; (b) 502 when LLM unavailable; (c) clips unknown tokens out |
| `POST /api/songs` | (a) inserts row + debits ledger; (b) 402 on insufficient notes; (c) idempotency: same key returns the same row |
| `GET /api/songs` | (a) returns own songs only; (b) pagination cursor advances |
| `DELETE /api/songs/[id]` | (a) deletes own; (b) 404 on other user's id |
| `POST /api/billing/webhook` | (a) verifies Waffo signature over raw body; (b) duplicate delivery id no-ops; (c) `order.completed` creates purchases + ledger rows; (d) `refund.succeeded` reverses the top-up and marks the purchase refunded |
| `POST /api/auth/login/init` + `/callback` | (a) issues session; (b) double-init invalidates prior |
| `POST /api/account/delete` | (a) soft-marks; (b) revokes sessions; (c) does not delete songs synchronously |

Current route coverage is already colocated with many handlers. A fuller
DB-backed API test harness is still useful for cross-route transaction cases,
but new route work should add the nearest useful `route.test.ts` now rather
than waiting for that harness.

### 5.3 Conventions

- One file per route: colocated `route.test.ts` beside the handler, or
  `src/tests/api/<area>/<resource>.test.ts` if the shared harness needs it.
- Test data created inline via `freshDb` seed helpers; no fixture
  files unless the data is huge.
- Always assert the **error envelope** matches the convention
  (`api-conventions.md` §3).

---

## 6. Golden master — music output

The arrangement engine is **deterministic** by design (see
`docs/music-engine.md`). v2 makes that contract testable: a fixed
`melody + vibe + seed` produces a fixed `AssembledSong`.

### 6.1 Storage

Inputs may live beside the tests or under `src/tests/music/__fixtures__/` when
they become large enough to share:

```
__fixtures__/
├── melody-d-minor-12notes.json       (a CleanMelody)
├── melody-g-major-08notes.json
├── melody-pentatonic.json
└── golden/
    ├── sunset-seed-abc123.json       (AssembledSong)
    ├── party-seed-abc123.json
    └── …
```

### 6.2 Test shape

```ts
describe("golden masters: sunset vibe", () => {
  it("produces the recorded arrangement for melody-d-minor-12notes", () => {
    const melody = readJsonFixture("melody-d-minor-12notes.json");
    const versions = generateVibeVersions(melody, { seed: "abc123" });
    const sunset = versions.find(v => v.vibe === "Sunset")!;
    const assembled = assembleSong(sunset);
    expect(assembled).toEqualGolden("golden/sunset-seed-abc123.json");
  });
});
```

`toEqualGolden` reads the file; if `UPDATE_GOLDENS=1`, it overwrites
and the test passes. A reviewer reads the diff in the PR before
merging.

This catches:

- Accidental arrangement-engine regressions.
- Subtle changes in BPM detection / quantize.
- Pre/post Tone.js fix-ups that change timing.

It does NOT catch the things only your ears notice; that is the manual
layer.

---

## 7. Audio worker tests

```
workers/audio-engine/tests/
├── test_decode.py            # webm + m4a + mp3 + wav decode paths
├── test_denoise.py           # denoise provider selection/fallback behavior
├── test_pitch.py             # pitch providers return expected note counts for fixtures
├── test_pipeline.py          # end-to-end: blob in → ScoredMelody out
└── __fixtures__/
    ├── hum-clean.wav         # 10 s, clean room
    ├── hum-noisy.wav         # 10 s, with HVAC
    ├── hum-silence.wav       # 10 s, no signal
    └── hum-octave-jump.wav   # known octave-jump case
```

Required cases:

- `test_pitch.py`: the configured pitch path on `hum-clean.wav` produces ≥6
  notes with ≥0.5 confidence; on `hum-silence.wav` returns empty.
- `test_pipeline.py`: end-to-end returns 200 with a concrete worker provider
  from the `auto` chain for the clean fixture; 422 for `hum-silence.wav`.
- `test_decode.py`: every supported format decodes to mono 22.05 kHz
  float32 with non-zero length.

Current Phase 1 starts with dependency-light worker unit tests:

```bash
bun run test:audio
```

This runs `python3 -m unittest discover -s tests` inside
`workers/audio-engine/` and covers frame-to-note segmentation plus pitch and
denoise provider selection.

The full dependency lane is:

```bash
python -m pip install -r workers/audio-engine/requirements.txt
bun run test:audio:full
```

It runs synthetic WAV decode/trim/pYIN smoke tests under
`workers/audio-engine/tests_full/`. When runtime deps are absent, those tests
skip cleanly so lightweight local validation stays fast. CI installs worker
deps and runs both lanes.

The optional denoise lane is:

```bash
python -m pip install -r workers/audio-engine/requirements-denoise.txt
bun run test:audio:full
```

When those optional deps are present, `tests_full/test_denoise.py` verifies the
DeepFilterNet provider on synthetic noisy audio. Once real recorded fixtures
land, expand this from synthetic smoke coverage to golden acceptance tests.

---

## 8. E2E

### 8.1 Web (Playwright)

A small set of "the product loop survives a real browser" tests:

1. **Happy path**: open `/`, allow mic stub, click "Try a demo
   melody," reach `/vibe`, pick a card, reach `/studio`, save with
   name, reach `/song/[id]`, hear playback.
2. **Topup loop**: from `/studio` with balance = 0, save button shows
   "need 1 note → Top up," follow link, complete Stripe test purchase,
   return to `/studio`, save now succeeds.
3. **Account delete**: settings → delete → confirm → logged out,
   re-sign-in shows the 7-day undelete prompt.

Stub the mic via `page.context().grantPermissions(['microphone'])`
and inject a known fixture audio via a `?demo=1` URL param. Stub
Stripe with their `sk_test_*` keys.

### 8.2 Capacitor smoke

After Phase 6, a single nightly run launches the iOS simulator and
exercises the happy path through native shells. Pass criteria: app
launches, records, transcribes, saves.

### 8.3 MP smoke (post-Phase 7)

Taro CLI ships an emulator harness. The smoke test confirms record →
upload → ScoredMelody → save → list. Coverage is intentionally
narrower than Web.

---

## 9. Coverage policy

We **do not** chase a coverage percentage. We chase **invariants** and
**user-visible failures**.

- A bug found in prod adds a test before it is fixed.
- A new feature must include the integration test for its happy path
  before merge.
- Routes always have at least the table in §5.2.

Tracking: a `pnpm test:coverage` is fine to have but not gating.

---

## 10. Test data + factories

Avoid free-floating literals. A small factory module in
`src/tests/factories.ts` once a shared DB/API harness exists:

```ts
export function makeUser(overrides?: Partial<User>): User {
  return {
    id: "usr_" + ulid(),
    email: `${ulid()}@test`,
    notesBalance: 5,
    planTier: "free",
    regionId: "intl",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeSong(overrides?: Partial<Song>): Song { ... }
export function makeMelody(overrides?: Partial<CleanMelody>): CleanMelody { ... }
```

This makes test setup readable and lets fixtures evolve as the schema
does.

---

## 11. Time + IO control

Tests never use:

- `await new Promise(r => setTimeout(r, 100))`
- Live network calls
- The real Stripe / RevenueCat / WeChat APIs

Tests do use:

- Bun's fake timers (`mock.module("timers")`).
- A `fakeFetch` injected via DI into the API client when the SUT calls
  out.

Webhook tests construct the signed body and call the route directly.

---

## 12. Test environment

GitHub Actions currently lives under `.github/workflows/ci.yml` and should keep
covering:

- A Postgres service container.
- The audio worker's deps, RMVPE model prep, and SwiftF0/pYIN fallback runtime.
- `bun install`, `bun test`, `pytest workers/audio-engine`.

Failure of any job blocks merge.

---

## 13. Acceptance criteria

- [ ] At least one test in every layer in §1 exists and runs in CI.
- [ ] Every route in §5.2 has its required cases.
- [ ] A golden master file exists for at least one melody × every
      vibe.
- [ ] `bun test` runs green on a fresh clone after `bun install`.
- [ ] `pytest workers/audio-engine` runs green on a fresh clone.
- [ ] CI workflow blocks merge on red.

---

## 14. What this strategy deliberately omits

- **Mutation testing.** ROI too low for v2.
- **Snapshot tests of React trees.** Too brittle; we already have
  golden masters for the things that need them.
- **Performance regressions in tests.** Bench separately when needed
  (see `observability.md`).
- **Property-based tests.** Worth a try for the polisher, but not
  required.

Sibling docs: `engineering-standards.md`, `api-conventions.md`,
`data-model.md`, `observability.md`, `audio-pipeline-redesign.md`.
