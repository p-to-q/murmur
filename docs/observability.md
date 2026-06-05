# Observability

This page is the stable landing page for Murmur's observability contract.
Several v2 docs reference it for event taxonomy, replay/debug surfaces, and
operator visibility.

## Out of scope

This bridge page does not define a full metrics dashboard or vendor-specific
stack. It anchors the observability intent that other docs already rely on.

## Current implementation surfaces

Today's checked-in observability code lives here:

- [src/lib/observability/log.ts](../src/lib/observability/log.ts)
- [src/lib/observability/recent-events.ts](../src/lib/observability/recent-events.ts)
- [src/app/me/page.tsx](../src/app/me/page.tsx) for the
  current user-facing debug and support-adjacent surface

## Minimum contract

Until a fuller observability spec is restored, treat these as the floor:

1. User-visible failures should emit structured logs and, where appropriate, a
   support code in the form `<AREA>-<ERROR>-<SHORTID>`.
2. Important route and worker failures should be visible in recent-events or an
   equivalent debug surface.
3. Product changes that alter support, fallback, billing, transcription, or
   export behavior should note what event/log surface changed.

Planned but not yet present in this branch:

- `src/lib/observability/support-code.ts`
- `src/app/api/observability/recent-events/route.ts`
- `src/app/me/debug/page.tsx`

## Related docs

- [testing-strategy.md](testing-strategy.md)
- [repository-operations.md](repository-operations.md)
- [review-gates.md](review-gates.md)
- [research-2026-06.md](research-2026-06.md)

## Next durable upgrade

Expand this file into the full event taxonomy and dashboard contract when the
observability surface stabilizes, rather than creating a new filename.
