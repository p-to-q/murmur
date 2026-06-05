# Page Contracts

This page is the stable landing page for Murmur's v2 page-contract references.
Multiple planning docs refer to `page-contracts.md` as the source of truth for
what each screen must guarantee.

## Out of scope

This bridge page does not attempt to fully recreate the missing per-screen JSON
contracts. It exists so links resolve and readers can still navigate to the
closest active specs.

## Current sources of truth

Use these documents together:

- [page-redesign.md](page-redesign.md) for screen-by-screen product intent and
  layout direction
- [design-language.md](design-language.md) for UI system constraints and visual
  rules
- [api-conventions.md](api-conventions.md) for route and payload expectations
- [user-model.md](user-model.md) for user/session/entitlement state
- [data-model.md](data-model.md) for persisted entities behind page state
- [cross-platform-strategy.md](cross-platform-strategy.md) for shell-specific
  boundaries

## Practical reading order

If you are implementing or reviewing a screen:

1. Read [page-redesign.md](page-redesign.md)
2. Read [design-language.md](design-language.md)
3. Read [api-conventions.md](api-conventions.md) if the screen touches a route
4. Read [user-model.md](user-model.md) and [data-model.md](data-model.md) if
   the screen depends on identity, quota, billing, or saved content

## Next durable upgrade

If we restore explicit per-page contracts, keep this filename and expand it
instead of creating another parallel page-spec document.
