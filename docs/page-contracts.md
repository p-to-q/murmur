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

## Hum page contract notes

The current Hum landing surface is intentionally split into one macro stage
with two locked sub-boxes:

- the headline block keeps a fixed reserved height so rotating idle copy does
  not nudge the orb
- the orb column keeps a fixed visual footprint so hover / press / recording
  scale changes stay centered

Interaction rules that should remain true:

- the white orb uses press-and-hold for live recording
- idle hover expands the orb slightly; recording state keeps the smaller held
  scale
- demo melody is explicit, not a hidden fallback from live capture
- live recording must ensure a server-backed Local Creator session before
  upload; production `/api/transcribe` should not see a first-visit guest race
- billing / note exhaustion should preserve a clear recovery path instead of
  collapsing into generic retry copy
- browser recording failures should surface as a quiet card with a stable
  retry or demo action
- first-run onboarding owns the full viewport while visible: any click advances
  the copy, the final onboarding click only dismisses the overlay, and live
  recording remains a separate post-onboarding orb action
- global audio-unlock hints should wait until first-run onboarding is complete
  so permission guidance does not appear inside the onboarding veil

Implementation note:

- keep recording cleanup, audio stream teardown, and timer clearing inside the
  screen boundary
- keep transcription / fixture branching inside the client transcription
  facade, not in the view tree
- keep onboarding persistence and completion events in the shared onboarding
  helper so the Hum screen and global audio unlock layer cannot drift
- keep auth/session readiness separate from worker availability so a 401 does
  not masquerade as the "service is napping" worker outage state

## Me personal-center contract notes

`/me` is the parent territory for account-owned utility pages. The desktop
sidebar should expose the currently active account page as a second-level row
under Me, not as a new top-level destination and not as a fully expanded
account menu:

- `/me/settings` — durable user preferences and local device-facing settings
- `/me/payments` — note top-up receipts and provider reconciliation state
- `/me/privacy` — privacy policy, consent, and future privacy controls
- `/me/delete` — account deletion request and retention/cooldown status

Future personal-center features should prefer `/me/<feature>` unless they are
part of a focused purchase handoff. Purchase flows may keep `/topup` and
`/topup/checkout`, but they still belong to the Me trail in navigation because
they manage account entitlements rather than creation flow.

Compatibility note:

- `/privacy` remains a public compatibility URL, but it redirects to
  `/me/privacy` so in-app navigation has one canonical personal-center path.
