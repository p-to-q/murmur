/**
 * Shared types — placeholder.
 *
 * The full carve-out happens in Phase 5 of docs/execution-roadmap.md.
 * For now, the canonical type definitions still live in:
 *
 *   apps/web/src/modules/shared/types.ts
 *
 * When Codex starts Phase 5 step 2, move that file's contents here and
 * update apps/web/src/modules/shared/types.ts to re-export from
 * `@murmur/core/shared-types` (or delete it entirely).
 *
 * This placeholder file exists so:
 *   1. The package compiles in isolation.
 *   2. The eventual import path `@murmur/core/shared-types` is reserved.
 *   3. Codex knows where the types go.
 */

// Intentionally empty. Do not add types ad-hoc here — move the whole
// `apps/web/src/modules/shared/types.ts` over as a batch in Phase 5.
export {};
