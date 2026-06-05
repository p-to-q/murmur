# Repo Architecture

How the Murmur monorepo is laid out for v2: which directories exist,
what each is for, what each can and cannot import, and how new code is
placed. This is the file Codex consults whenever the question is "where
does this go?"

It is the structural contract; behavior contracts live in
`page-contracts.md` and `api-conventions.md`.

---

## 1. Goals

- **One repo, three shells, one backend.** Web (Next.js), iOS / Android
  (Capacitor), 微信小程序 (Taro). All read from one server.
- **Algorithm core is shell-agnostic.** Anything music-, payment-, or
  user-logic-related lives outside of shells, in `packages/murmur-core`.
- **Import boundaries are physical.** A shell cannot reach into another
  shell. A package cannot import from a shell. The compiler enforces
  this via path aliases + ESLint rules.
- **Workers are siblings, not nested.** Audio worker (Python) is a
  first-class top-level directory; deploy / build pipelines treat it
  on equal footing with the Next.js app.

The current state (single `src/`, no packages, one worker subdir) is the
"phase 0" version of this layout. Phase 5 of `execution-roadmap.md`
ships the carve-out.

---

## 2. Top-level layout

```
murmur/
├── apps/
│   ├── web/                 # current src/ → moved here
│   ├── capacitor/           # NEW Capacitor wrapper + ios/ + android/
│   └── miniprogram/         # NEW Taro 4 project for 微信 MP
├── packages/
│   ├── murmur-core/         # NEW pure-TS algorithm + types + i18n + payments lib
│   ├── murmur-api-client/   # NEW thin fetch wrappers, shared across shells
│   └── murmur-ui-tokens/    # NEW design tokens (colors, fonts, spacing, motion)
├── workers/
│   └── audio-engine/        # Python audio worker (renamed from basic-pitch-service)
├── infra/                   # NEW Docker, Fly, 腾讯云 manifests, GitHub Actions
├── docs/                    # all docs (this file lives here)
└── scripts/                 # one-off dev scripts, kept tiny
```

The migration plan is in §11.

### What each directory holds

- **`apps/web/`** — Next.js App Router, the canonical reference shell.
  All `/api/*` routes live here (they are server, but they ship with
  the web app for hosting simplicity).
- **`apps/capacitor/`** — Capacitor project. `www/` is generated from
  `apps/web`'s static export. `ios/` and `android/` are checked in.
- **`apps/miniprogram/`** — Taro 4 project. Has its own pages but
  imports `packages/murmur-core` for logic.
- **`packages/murmur-core/`** — the algorithm core, pure TypeScript:
  types, the arrangement engine, the polisher (post-port), payment
  cost table, EditTokens, entitlement helpers, i18n dict and translator.
  **No DOM, no React, no `window`.**
- **`packages/murmur-api-client/`** — typed fetch wrappers around every
  `/api/*` route. Used by all shells.
- **`packages/murmur-ui-tokens/`** — colors, fonts, spacing, motion
  primitives. Shells consume these and translate to their own primitives
  (CSS variables, Capacitor styles, Taro styles).
- **`workers/audio-engine/`** — Python FastAPI worker. Containerized,
  deployed independently.
- **`infra/`** — `Dockerfile`s, fly.toml, 腾讯云 SCF / CVM manifests,
  GitHub Actions workflows, environment matrix.

---

## 3. Workspace setup

Use Bun workspaces (we already use Bun).

`package.json` at the root:

```json
{
  "name": "murmur",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:web":         "bun --filter ./apps/web dev",
    "dev:cap":         "bun --filter ./apps/capacitor dev",
    "dev:mp":          "bun --filter ./apps/miniprogram dev",
    "build:web":       "bun --filter ./apps/web build",
    "build:cap":       "bun --filter ./apps/capacitor build",
    "build:mp":        "bun --filter ./apps/miniprogram build",
    "test":            "bun test",
    "test:web":        "bun --filter ./apps/web test",
    "test:packages":   "bun --filter ./packages/* test",
    "test:audio":      "cd workers/audio-engine && pytest",
    "lint":            "bun --filter './apps/*' --filter './packages/*' lint",
    "db:generate":     "bun --filter ./apps/web db:generate",
    "db:migrate":      "bun --filter ./apps/web db:migrate"
  }
}
```

Each app + package has its own `package.json` with its own deps. Heavy
deps (`tone`, `framer-motion`) stay in `apps/web` only — `packages/murmur-core`
must not pull them.

---

## 4. Path aliases + import rules

### TypeScript paths

Root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@murmur/core/*":       ["packages/murmur-core/src/*"],
      "@murmur/api-client/*": ["packages/murmur-api-client/src/*"],
      "@murmur/ui-tokens/*":  ["packages/murmur-ui-tokens/src/*"]
    }
  }
}
```

Each app extends this; `apps/web/tsconfig.json` adds `@/*` →
`./src/*` (preserves today's import style for app-local files).

### Allowed imports

| From | May import |
|---|---|
| `apps/web/*` | `@murmur/core/*`, `@murmur/api-client/*`, `@murmur/ui-tokens/*`, `@/*` (app-local), `next/*`, `react`, `framer-motion`, `tone`, `drizzle-orm`, … |
| `apps/capacitor/*` | same as web (it wraps web) + `@capacitor/*` plugins |
| `apps/miniprogram/*` | `@murmur/core/*`, `@murmur/api-client/*`, `@murmur/ui-tokens/*`, `@tarojs/*` |
| `packages/murmur-core/*` | NONE outside its own folder, only standard JS (`crypto`, `Math`, etc.) |
| `packages/murmur-api-client/*` | `@murmur/core/*` for types only |
| `packages/murmur-ui-tokens/*` | NONE |
| `workers/audio-engine/*` | Python ecosystem only |

### Enforcement

- ESLint rule: `no-restricted-imports` with patterns blocking shell→shell
  and shell→package-internal imports.
- `tsc --noEmit` runs in CI on every package independently, so a leak
  surfaces before a PR merges.
- A simple `scripts/check-boundaries.ts` script greps for forbidden
  patterns and runs in CI.

---

## 5. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` / `kebab-case.tsx` | `audio-worker.ts`, `topup-screen.tsx` |
| React components | `PascalCase` exported name; filename matches | `TopupScreen` in `topup-screen.tsx` |
| Hooks | `useCamelCase` | `useUserBalance` |
| Types | `PascalCase` | `ScoredMelody`, `EditToken` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_HUM_DURATION = 15` |
| Server routes | `app/api/<area>/<noun>/route.ts` | `app/api/billing/checkout/route.ts` |
| Test files | `<unit>.test.ts` or `__tests__/<unit>.ts` | `melody-polisher.test.ts` |
| Schema files | `src/lib/db/schema/<entity>.ts` | `notes-ledger.ts` |
| i18n keys | `dot.case.lowercase` | `topup.cta.buy_notes` |

Components named after screens (`HumScreen`, `StudioScreen`) stay as
"screen + role" wherever they live; pages mount them.

---

## 6. Directory hygiene inside each app

### `apps/web/src/`

```
src/
├── app/                      # Next.js routes + layouts + API routes
├── components/
│   ├── screens/              # one per page (HumScreen, StudioScreen…)
│   ├── murmur/                # cross-page shell pieces (nav, backdrops)
│   ├── ui/                    # generic UI primitives (button, sheet)
│   └── <feature>/             # feature-scoped components (studio/, song-detail/)
├── hooks/                     # NEW — useCurrentUser, useUserBalance, …
├── lib/
│   ├── api/                   # client-side API surface (thin wrappers around api-client)
│   ├── auth/                  # session helpers (server- + client-side)
│   ├── db/                    # Drizzle schema + queries + migrations
│   ├── platform/              # platform-specific adapters
│   ├── store/                 # zustand stores (one per concern; not one giant)
│   ├── i18n/                  # re-export from @murmur/core/i18n (slim)
│   └── visual/                # song-detail canvas helpers
└── modules/                   # legacy term — fold into packages/murmur-core during the carve-out
```

`modules/` becomes a transient term: every file in `src/modules/` that
is pure logic moves to `packages/murmur-core` in phase 5. Files that
import the DOM or React stay in `apps/web/src/`. The carve plan in §11
lists each file.

### `packages/murmur-core/src/`

```
src/
├── arrangement/             # apply-edit.ts, generate-versions.ts, assemble-song.ts
├── audio/                   # melody-polisher.ts (TS, if not ported to Python)
├── auth/                    # entitlements.ts, user-types.ts
├── i18n/                    # dict.ts, translator.ts
├── music/                   # chord/bass/drum engines, pitch-engine (when TS-side stays)
├── payments/                # cost-table.ts, sku-types.ts
├── shared-types/            # MelodyNote, CleanMelody, EditToken, Sku, User, Session
└── index.ts                 # public re-exports
```

The export surface is curated. Internal helpers are not re-exported
from `index.ts`. Shells import from `@murmur/core` (the package root) by
default, falling back to subpaths when they need a specific submodule.

---

## 7. Where Drizzle lives

The DB schema is the property of the **backend**, not of the algorithm
core. So Drizzle stays in `apps/web/src/lib/db/`. Reasons:

- Drizzle pulls in `postgres`, which packages should not.
- Migration generation is tied to one runtime.
- Queries live next to the routes that call them.

If a future shell needs read-only DB access (it won't in v2), it routes
through the backend API, not direct DB.

`packages/murmur-core` may import `apps/web`'s **types** via a generated
`db-types.d.ts` (Codex generates this from
`drizzle.config.ts` using `drizzle-kit introspect` or hand-rolls the
mirror — pick the lightest path). The package itself does not depend on
Drizzle.

---

## 8. Versioning + deprecation

This is a single-repo, single-release product. We do not ship semver
versions of the packages externally; the lockfile pins the intra-repo
version. But we still mark deprecation:

- A `@deprecated` JSDoc tag on every symbol slated for removal, with a
  one-line note: `// @deprecated since v2; use X. Removed v3.`
- A `DEPRECATIONS.md` at the repo root lists each tag + target removal
  date.
- Lints fail on **new** uses of deprecated symbols (`eslint
  no-deprecated`); existing uses warn until they're migrated.

The current `src/lib/music/stainer.ts` + the legacy
`src/lib/music/providers/` directories are deprecated by the v2 audio
work — mark them on day one of phase 1.

---

## 9. CI + branching

(Not implemented in v1; v2 needs it.)

- Branches: `main` is shippable. Work happens on `feat/<short>` /
  `fix/<short>` / `arch/<short>` branches.
- PRs: required for `main`. One reviewer minimum (human or AI). PR
  template includes:
  - what changed + why
  - explicit "Done" checklist tied to the relevant v2 doc
  - validation run (`bun lint`, `bun test`, `bun build`, ad-hoc manual
    notes)
  - migration risk if any
- CI (GitHub Actions, `infra/.github/workflows/`):
  - `lint.yml` — ESLint + TS check per workspace.
  - `test.yml` — `bun test` across packages + apps; `pytest` in the audio
    worker.
  - `build.yml` — `next build` for web; `cap build` for Capacitor (smoke,
    not signed).
  - `migrations-dry.yml` — `drizzle-kit generate` should be no-op on the
    PR branch unless explicitly intended.

We currently have zero of these. Phase 4 adds them.

---

## 10. Infra layer

```
infra/
├── docker/
│   ├── audio-engine.Dockerfile        # builds workers/audio-engine
│   └── web.Dockerfile                  # builds apps/web (Vercel-style)
├── fly/
│   ├── audio-engine.fly.toml
│   └── web.fly.toml                    # if not Vercel
├── tencent/
│   ├── audio-engine.scf.yaml
│   └── web.region-cn.yaml
└── github/
    └── workflows/
        ├── lint.yml
        ├── test.yml
        ├── build.yml
        └── migrations-dry.yml
```

Infra is checked-in so any agent can stand up a fresh region. Secrets
are not in this directory; they live in the deploy provider's secret
store.

---

## 11. Migration plan (phase 5 of the roadmap)

The carve-out is **mechanical and reversible**. Sequence:

1. **Add the structure** (this PR / commit):
   - Create empty `packages/` dirs + minimal `package.json`s.
   - Add `tsconfig.base.json` and update `apps/web/tsconfig.json`.
   - Update root `package.json` with workspaces.
   - Do NOT move any files yet.
2. **Move types only.** Copy
   `src/modules/shared/types.ts` →
   `packages/murmur-core/src/shared-types/index.ts`. Update `apps/web`
   imports. Delete the old file. One PR.
3. **Move pure logic.** `src/modules/strummer/apply-edit.ts`,
   `src/modules/strummer/generate-code.ts`,
   `src/modules/music/melody-polisher.ts`,
   `src/lib/music/chord-engine.ts` + sibling engines + `assemble-song.ts`,
   `src/presets/vibes.ts`. One PR each or batched.
4. **Move i18n.** `src/lib/i18n/dict.ts` and translator helpers.
5. **Move payments cost table.** Add fresh in
   `packages/murmur-core/src/payments/cost-table.ts`.
6. **Move auth helpers.** `entitlements.ts`,
   `user-types.ts`. The session resolver stays in `apps/web`.

Each step is a self-contained PR that satisfies the engineering-standards
checklist. None changes behavior; all change locations.

**Rollback safety:** if a step breaks, revert; the prior state still
runs.

---

## 12. Things this layout deliberately rejects

- **One mega `src/`.** Today's layout. Cannot serve two shells.
- **A shared "common" or "shared" directory.** Generic dumping grounds
  rot fast. `murmur-core` is named for what it owns; if a thing doesn't
  belong, it doesn't go in.
- **A `packages/ui/` shared React component library.** UI components
  belong to shells. Cross-shell reuse stops at design tokens.
- **Backend in a separate repo.** The backend ships with the web app;
  splitting it adds deploy coordination cost we do not need at v2 scale.
- **Microservices.** One Next.js + one audio worker. Anything else is
  premature.

---

## 13. Acceptance criteria

A downstream agent has shipped this when:

- [ ] `apps/web/` is the new home of the current Next.js app; old
      `src/` is gone.
- [ ] `packages/murmur-core` builds standalone and exports the types,
      engines, and helpers listed in §6.
- [ ] `packages/murmur-api-client` exports typed wrappers for every
      `/api/*` route used by a shell.
- [ ] No shell imports another shell.
- [ ] `apps/web` runs identically (lint + build + tests + manual smoke).
- [ ] CI pipeline runs lint + test + build for every workspace.
- [ ] `DEPRECATIONS.md` exists and lists the current legacy bits.

---

## 14. Where this contract is enforced

| Concern | Enforced by |
|---|---|
| Import boundaries | ESLint `no-restricted-imports` + CI |
| Workspace topology | Bun workspaces + the root `package.json` |
| Path aliases | `tsconfig.base.json` |
| Naming conventions | review + ad-hoc lint rules |
| Deprecation discipline | `DEPRECATIONS.md` + `@deprecated` lint |
| CI / branching | `infra/github/workflows/` |

Sibling docs: `engineering-standards.md`, `testing-strategy.md`,
`observability.md`, `execution-roadmap.md`, `data-model.md`.
