# Engineering Standards

The companion to `engineering-principles.md`. Principles are
philosophy; standards are the rules that turn philosophy into shipped
code. This doc is the bar Codex meets in every PR.

`engineering-principles.md` stays as the foundation. This file
**extends** it for the v2 era. Where the two conflict, this file wins
for v2-scope work.

---

## 1. The bar

Every PR clears these in order. A PR that does not clear them is sent
back, not "we'll fix it in follow-up."

1. **Correct.** The change does what the doc + PR description say it
   does. Tests in the relevant layer pass (`testing-strategy.md`).
2. **Bounded.** The change touches the files necessary and no more.
   Drive-by formatting is rejected; submit it as a separate PR.
3. **Typed.** New code is fully typed. `any` is banned outside `tests/`
   without a `// reason: …` comment.
4. **Logged.** New routes / actions emit the canonical events from
   `observability.md` §2.
5. **Documented.** Public symbols (exported from
   `packages/murmur-core` or any `apps/*/src/lib/*`) have a JSDoc
   header. Internal helpers do not need one unless the name is not
   self-documenting.
6. **Reversible.** Migrations have a `down.sql`. Removals are
   `@deprecated` first, deleted later.
7. **Lint + build + test green.** No exceptions, no `--no-verify`.

---

## 2. TypeScript discipline

- `strict: true` everywhere (already on).
- No `any`. Use `unknown` and narrow.
- No `as <T>` casts to silence the compiler; use `satisfies` or a real
  type guard.
- No `// @ts-ignore`. Use `// @ts-expect-error <reason>` only when the
  alternative is genuinely harder to read.
- Exhaustive `switch`: end with `default: assertNever(value)`.
- Prefer `const` arrays of literal strings + a derived union over a
  free-standing union when the values exist at runtime
  (cf. the instrument / provider registries in
  [audio-worker.ts](../src/lib/platform/audio-worker.ts)).

### Zod boundary

Every API route validates its body with `zod`. The TS type is derived:

```ts
const BodySchema = z.object({ ... });
type Body = z.infer<typeof BodySchema>;
```

No hand-rolled validators on the request boundary; no relying on
TypeScript at runtime.

---

## 3. Error handling

- All thrown errors extend `class MurmurError extends Error` with
  a typed `code: ErrorCode`. Lives in
  `apps/web/src/lib/api/errors.ts`.
- Route handlers convert thrown `MurmurError`s into the envelope from
  `api-conventions.md` §3.2 via `errorEnvelope(e, requestId)`.
- Catch + rethrow is acceptable to add context; catch + swallow is
  not.
- Top-level swallowed errors (`.catch(() => {})`) are limited to
  fire-and-forget audit events. Every other swallowed catch needs a
  comment.

### Domain errors

Audio + payment have specific error types. Codex defines them per
feature:

```ts
class TranscribeError extends MurmurError { /* no_voiced_frames, … */ }
class BillingError    extends MurmurError { /* insufficient_notes, signature_invalid, … */ }
class AuthError       extends MurmurError { /* unauthorized, session_expired, … */ }
```

Catch by class on the route side; switch on `.code` inside.

---

## 4. Async + concurrency

- Always `await` Promises. A floating Promise that isn't awaited
  triggers a lint error (`@typescript-eslint/no-floating-promises`).
- Use `Promise.allSettled` when partial failure is acceptable;
  `Promise.all` when it isn't.
- Long-running server tasks (>10 s) move to a background worker
  pattern; do not block a route handler.
- No `setTimeout` for "retry later" inside request handlers; either
  return early and let the client retry, or queue.

---

## 5. State management

- Server state goes in Postgres + object storage; no shared in-process
  state across requests.
- Client state lives in:
  - `useState` / `useReducer` for component-local state.
  - **zustand** stores for cross-component, per-shell global state.
    One store per concern; do not concatenate into a single mega-store.
  - The current `murmur-store.ts` is split in v2 into:
    `recording-store.ts`, `version-store.ts`,
    `current-version-store.ts`, `gallery-store.ts`, `playback-store.ts`.
- No `redux`, no `mobx`, no `recoil`.
- React Server Components are used for static + slow-changing reads;
  client components handle interactivity.

---

## 6. Dependencies

- New deps require justification in the PR description. "We didn't
  have a strong reason" is the wrong answer.
- Prefer tiny + well-maintained over large + comprehensive.
- Banned for v2 unless explicitly approved:
  - `moment` (use `date-fns` or native).
  - `lodash` (use ES native).
  - `axios` (use `fetch`).
  - `redux`, `react-query` (zustand + SWR are the stack).
- Audit every transitive dep that hits >1 MB minified.

`bun audit` runs in CI; high-severity advisories block merge.

---

## 7. Naming

(Per `repo-architecture.md` §5; restated to make this file a one-stop
shop.)

- Files: `kebab-case.ts`.
- Components: `PascalCase` exported name, filename matches.
- Hooks: `useCamelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Server routes: `app/api/<area>/<resource>/route.ts`.
- Test files: `<unit>.test.ts` or `__tests__/<unit>.ts`.

When in doubt, copy the closest existing name.

---

## 8. PR + commit hygiene

### Commits

- Imperative present tense subject line, ≤ 72 chars.
- Optional body wraps at 80; explains the "why."
- One logical change per commit.
- Co-author lines for AI commits (already enforced in the harness).

### PRs

Template (Codex updates `.github/pull_request_template.md`):

```markdown
## What
…one paragraph…

## Why
…links to the doc / phase / issue…

## Done checklist
- [ ] Tests added / updated (`testing-strategy.md`)
- [ ] Observability events emitted (`observability.md` §2)
- [ ] Migration reversible (`data-model.md`)
- [ ] Lint + build + test green
- [ ] Behavior change noted in CHANGELOG.md

## Out of scope
…what this PR does not do, deliberately…

## Validation
…what I ran, what I did not run, what residual risk remains…
```

### Branches

- One branch = one PR = one merge. No long-lived feature branches.
- Names: `arch/<scope>`, `feat/<scope>`, `fix/<scope>`, `chore/<scope>`,
  `docs/<scope>`.

---

## 9. Deprecation discipline

- `@deprecated since v2; use X. Removed v3.` on every symbol slated
  for removal.
- Add a row to `DEPRECATIONS.md` at the repo root.
- A `no-deprecated` lint rule warns on new uses.
- v2 RELEASE notes call out anything removed in the same release.

Today's v1 surfaces marked deprecated immediately:

- `src/lib/music/stainer.ts` and `src/lib/music/providers/*` (replaced by
  `packages/murmur-core/...`).
- `src/modules/stainer/providers/browser-basic-pitch.ts` and
  the old remote worker prototype (replaced by the server pipeline in
  `src/lib/platform/audio-worker.ts` + `workers/audio-engine/main.py`).
- `users.notesBalance < 0` writes (no caller should produce these; the
  only writers are the helpers).
- `songs.mp3DataUrl` writes (object storage now).

---

## 10. Code review (between agents)

Even when Codex is the author, the human is the reviewer. Codex's PR
description tells the human what to look for in 90 seconds:

- The biggest risk in the diff.
- The thing the test does *not* cover.
- The performance implications, if any.

A PR description that doesn't surface its own risks gets sent back.

---

## 11. Performance

- No more than one DB roundtrip per route handler unless explicitly
  justified.
- No N+1 queries; use `INNER JOIN` or batched fetch.
- Tone.js renders (and any DOM heavy work) run off the main thread
  when feasible; today the Tone render is on-main and slow for long
  songs — server-side render targets this.
- API response p95 ≤ 300 ms for read routes, ≤ 1 s for writes,
  ≤ 3 s for `/api/transcribe`. SLO board in
  `observability.md` §3.

---

## 12. Security

- No secret in `NEXT_PUBLIC_*` env vars. Anything web-client-facing is
  public; treat it as such.
- All webhook routes verify signatures. No exceptions.
- All file uploads check content-type + size at ingest and reject
  on mismatch.
- All user-supplied strings that touch HTML (titles, share-html
  templates) go through a sanitizer; never `dangerouslySetInnerHTML`
  on user data.
- All redirects to user-supplied URLs validated against an allow-list.
- DB queries always use parameterized binds (Drizzle does this by
  default; reject manual string interpolation).
- `Content-Security-Policy` set in Next.js middleware; strict by
  default, relax per route.

---

## 13. Documentation hygiene

- Every new public API gets a one-line JSDoc.
- Every doc in `docs/` declares its own "Out of scope."
- Stale docs get a `@deprecated YYYY-MM-DD` admonition; obsolete docs
  get archived in `docs/archive/`, not deleted.
- `docs/README.md` index stays accurate.

---

## 14. Acceptance criteria

The standards are met when:

- [ ] `bun lint` includes rules for: `no-floating-promises`,
      `no-restricted-imports` (per `repo-architecture.md` §4),
      `no-deprecated`, `no-console` (except `console.error` until
      `log()` migration is complete).
- [ ] Each route in `apps/web/src/app/api/` emits its taxonomy event.
- [ ] `DEPRECATIONS.md` exists with the v1 surfaces listed in §9.
- [ ] `.github/pull_request_template.md` matches §8.
- [ ] CI rejects PRs that lack the Done checklist.

---

## 15. What this standard deliberately does not do

- It does not prescribe a specific commit-message bot.
- It does not prescribe a specific code-coverage threshold.
- It does not require pair programming or any human process.
- It does not bind us to a specific vendor (Sentry, RevenueCat, etc.);
  the standard is the **shape**, not the brand.

Sibling docs: `engineering-principles.md` (the philosophy parent),
`testing-strategy.md`, `observability.md`, `api-conventions.md`,
`repo-architecture.md`.
