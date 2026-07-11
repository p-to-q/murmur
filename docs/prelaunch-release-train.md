# Pre-launch release train

This document turns the current GitHub issue backlog into a sequence of small,
reviewable pull requests. It is a routing artifact, not a second issue tracker:
GitHub remains the source of truth for discussion and closure, while this file
records ordering, boundaries, and acceptance criteria across issues.

## Release intent

The next Murmur version should make the core journey more trustworthy:

`Hum -> Vibe -> Studio -> Save -> Gallery -> Song detail`

Work is ordered by user harm and architectural dependency:

1. correctness and release gates;
2. billing, persistence, and worker reliability;
3. recoverable generation UX;
4. product contracts and polish;
5. structural cleanup only where it unlocks the above.

Umbrella issues `#202` and `#194` stay open as audit indexes. Individual PRs
should update their checklists instead of claiming to close the whole umbrella.

## Pull request sequence

### Active review-debt PRs

| PR | Purpose | Merge rule |
| --- | --- | --- |
| #295 | Close the streaming and worker contract comments posted after #289 merged | Merge before extending the interim stream or audio-worker adapter. |
| #296 | Close user-facing auth, deletion, contrast, and disabled-state comments from #253/#285/#288 | Merge independently from billing and persistence work. |

### Planned lanes

| Lane | Proposed PR | Issues | Outcome | Depends on |
| --- | --- | --- | --- | --- |
| R0 | Backlog truth and stale-issue reconciliation | #202, #194, #215, #237 | Every audit item points to a live issue, merged PR, or explicit deferral | none |
| R1 | Restore test type checking | #221 | `bunx tsc --noEmit` checks application and tests without excluding test files | R0 |
| R2 | Restore critical unit/evaluation coverage | #214, #196 | Client fallback and melody-polisher behavior have direct regression tests | R1 |
| R3 | Add browser golden-path release gate | #247 | A deterministic browser test covers create, save, and public share | R1, R2 |
| R3a | Close transcribe operation accounting | #298 | Retry, refund, delivery, and reconciliation produce exactly one valid net charge | R1 |
| R3b | Decouple pending spend refunds from Waffo | #299 | Product refunds recover through a provider-neutral idempotent worker | R1 |
| R3c | Make generation recovery durable | #300 | Refresh resumes paid clips instead of purchasing and sampling them again | R3a, R3b |
| R4 | Harden Waffo purchase provenance | #237 | Checkout creates server-side expected purchase state before redirect | R1 |
| R4a | Version saved-song artifacts and provenance | #297 | Playback, editable source, lineage, and save replay have explicit durable contracts | R3c, R4 |
| R5 | Close database and worker launch contracts | #235, #220 | Pooled DB URL and worker health/deploy semantics are explicit and verifiable | R1 |
| R6 | Restore music quality evaluation | #201 | Evaluation suite is live; GPU deploy restoration remains a separate opt-in step | R2, R5 |
| R7 | Make generation degradation legible | #211, #216, #217 | Users see fallback quality and wait state; auto-audition becomes a preference | R2 |
| R8 | Design durable generation jobs | #244 | Job/status contract is documented before SSE or queue implementation | R5, R7 |
| R9 | Observability and AI operational follow-through | #207, #208, #210 | Cache behavior, durable stage events, and latency alerts have measurable sinks | R5 |
| R10 | Restore export capabilities safely | #198 | Poster and standalone HTML export return behind existing export boundaries | R2 |
| R11 | Establish product layout contracts | #256, #257, #266, #269, #272 | Shared empty, header, loading, navigation, and bottom-spacing contracts | R3 |
| R12 | Improve creation feedback | #260, #262, #263, #268, #271 | Recording, generation, entry, and transition feedback share motion rules | R11 |
| R13 | Complete visual consistency pass | #258, #259, #264, #265, #270 | Billing, settings, auth, navigation, and toast styling match design language | R11 |
| R14 | Split code only along active product seams | #225, #242, #243, #245, #246 | Boundaries become clearer without a repository-wide rewrite or dependency churn | R3-R13 |

## Complete open-issue matrix

Status values:

- `active`: current code confirms the problem;
- `partial`: part of the issue landed, but closure criteria are unmet;
- `verify-close`: likely fixed or stale; verify against `main`, then close/update;
- `design-first`: implementation would be premature without a contract;
- `opportunistic`: do only while changing the same product seam.

| Issue | Status | Release lane | Maintainer disposition |
| --- | --- | --- | --- |
| #272 Footer/bottom spacing | active | R11 | Define one shell spacing contract, then remove page-local exceptions. |
| #271 Missing micro-interactions | active | R12 | Apply shared hover/press/focus rules; respect reduced motion. |
| #270 Toast editorial styling | active | R13 | Style the existing Sonner boundary; do not add a second toast system. |
| #269 Scroll-to-top on navigation | active | R11 | Implement once at the app navigation boundary with back/forward exceptions. |
| #268 Page cross-fade | active | R12 | Add only after navigation and reduced-motion semantics are explicit. |
| #266 Skeleton/content mismatch | active | R11 | Build skeletons from actual page contracts, not a generic loader. |
| #265 Sidebar active state | active | R13 | Strengthen current navigation token without changing information architecture. |
| #264 Auth typography | active | R13 | Reuse the two-family design system and existing auth shell. |
| #263 Song detail entry animation | active | R12 | Keep playback immediately usable and motion optional. |
| #262 Recording button press feedback | partial | R12 | Verify the merged Hum feedback, then close or narrow to remaining device states. |
| #260 Generation progress hierarchy | active | R12 | Base copy on real pipeline phases and estimated wait, not timers alone. |
| #259 Settings spacing/alignment | active | R13 | Align to the page-header and form-row contracts from R11. |
| #258 Top-up card border treatment | active | R13 | Preserve SKU semantics and payment affordance while normalizing visuals. |
| #257 Header/back-nav inconsistency | active | R11 | Define a reusable page-header contract before editing individual screens. |
| #256 Inconsistent empty states | active | R11 | Define tone, CTA priority, illustration use, and retry behavior. |
| #247 Playwright golden path | active | R3 | Start with deterministic adapters; do not require live paid services. |
| #246 Decompose large screens | opportunistic | R14 | Extract recorder/save/playback seams only when their behavior is being changed. |
| #245 Split i18n dictionary | design-first | R14 | Measure bundle impact and preserve hydration/language-switch guarantees first. |
| #244 Polling to SSE | design-first | R8 | Define durable job ownership and reconnect semantics before choosing transport. |
| #243 Replace caches with query library | design-first | R14 | Require a demonstrated cache bug; avoid dependency churn as a goal itself. |
| #242 `lib`/`modules` boundary | partial | R14 | Add a written/import-check boundary before moving directories. |
| #237 Waffo pending purchase | active | R4 | Persist expected amount/SKU before checkout and validate webhook against it. |
| #235 Database pooler | partial | R5 | Enforce/document pooled production URL and a safe per-instance connection cap. |
| #225 Split mega-store | opportunistic | R14 | Preserve selectors and persisted draft compatibility; extract one concern per PR. |
| #221 Broken test type checking | active | R1 | Add Bun types, fix env mutation helpers, then repair fixtures in bounded batches. |
| #220 Worker deploy/monitor architecture | partial | R5 | Separate topology, health/readiness, graceful drain, and alerting contracts. |
| #217 Auto-audition preference | active | R7 | Put the preference in the existing preference store and honor mute/accessibility. |
| #216 `estimatedWaitMs` UX | active | R7 | Display honest ranges and record predicted versus actual wait. |
| #215 Missing request IDs | verify-close | R0 | #289 covered many paths; run a route response matrix and close remaining gaps only. |
| #214 v0.6 module tests | partial | R2 | Several modules now have tests; update the checklist and cover remaining seams. |
| #211 Fallback quality indicator | active | R7 | Add a calm non-blocking indicator with retry guidance and i18n copy. |
| #210 Latency alerting | active | R9 | Route existing budget events to a durable sink before adding dashboards. |
| #208 Durable stage analytics | active | R9 | Choose sink, consent, identifiers, and retention; isolate tracking by flow id. |
| #207 Anthropic cache control | verify-close | R9 | Confirm gateway/provider support and measure cache hits before adding fields. |
| #202 Full-repo audit | partial | R0 | Keep as an index; remove merged findings and link deferred clusters. |
| #201 Evaluation/GPU scripts | partial | R6 | Restore evaluation first; treat GPU deployment as a separate operational PR. |
| #198 Poster/HTML export | active | R10 | Reactivate each recovered module separately with current artifact tests. |
| #196 Melody-polisher tests | active | R2 | Follow the recovered-file checklist and restore the archived test only. |
| #194 Product UX audit | partial | R0 | Keep as an index; link focused issues and remove findings already fixed. |
| #298 Transcribe operation accounting | active | R3a | A stable spend key alone is insufficient; model delivered/refunded/pending transitions at the ledger boundary. |
| #299 Provider-neutral pending refunds | active | R3b | Product-spend compensation must not depend on Waffo credentials or availability. |
| #300 Durable generation recovery | active | R3c | Persist/reuse paid clip identity and artifact; do not restore every ready clip as a new pending purchase. |
| #297 Saved-song artifact provenance | design-first | R4a | Add a versioned compatibility reader before changing persisted arrangement or lineage semantics. |

## Newly confirmed gaps

These findings are visible in current `main` but do not have focused GitHub
issues yet. They should be opened before implementation so they do not disappear
inside an umbrella PR.

| Gap | Evidence | Proposed lane | Required shape |
| --- | --- | --- | --- |
| #292 New saves still write full MP3 data URLs to Postgres | `NameScreen` sends `mp3DataUrl`; songs schema stores it as text | R4b | Upload through the storage adapter and persist only an object URL; preserve legacy reads. |
| #291 A render failure can save a song with no shareable audio | Save logs the render failure and continues | R7b | Explicit retry-or-draft choice; draft state must be visible in Gallery/detail. |
| #293 Daily digest always uses Chinese copy | Cron calls `dailyDigestNotificationCopy("zh")` | R9b | Broadcast by persisted subscription locale with a defined fallback. |
| #290 Stage tracking uses one global mutable state | `lastStage` and timestamp are module singletons | R9c | Key state by flow id and bound its lifetime. |

## PR rules

Every PR in this train should contain:

1. one user/system problem and one primary outcome;
2. linked issues and explicit non-goals;
3. preserved compatibility/fallback behavior;
4. the lightest validation that proves the change;
5. an update to this matrix when status or ordering changes.

Large umbrellas, screen decomposition, i18n splitting, state-library migration,
and SSE are not valid single-PR outcomes. They must first produce a smaller
contract or independently useful artifact.
