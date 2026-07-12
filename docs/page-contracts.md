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
- first-run onboarding owns the full viewport while visible: any click / tap /
  Space | Enter advances the copy; the final onboarding click only dismisses
  the overlay, and live recording remains a separate post-onboarding orb action
- global audio-unlock hints should wait until first-run onboarding is complete
  so permission guidance does not appear inside the onboarding veil

Implementation note:

- keep recording cleanup, audio stream teardown, and timer clearing inside the
  screen boundary
- Home/Create navigation should continue the current unsaved creation draft
  when one exists, returning to Vibe, Studio, or Name instead of clearing the
  flow. Only explicit record-again / saved completion paths should discard the
  draft.
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
- `/me/notifications` — in-app notification inbox and management actions;
  browser alert and Web Push controls stay in the sidebar bell popover, and
  this page appears in the Me trail only after notifications are enabled
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

## Mobile rail notes

On narrow mobile screens, the bottom navigation now reads as a compact
journey rail: text steps separated by a narrow soundwave bar field, with the
active step carrying a single orange underline that slides between stages.
Idle bars stay nearly flat; processing and transition states make the bar
field taller and more varied. The rail stays visually lighter and narrower
than the desktop sidebar, and the `Me` entry remains a separate top-right
pocket drawer.

## Public song share contract notes

`/s/[shareCode]` is the listener-facing playback page for a song that the owner
has shared. It is not the author's editing surface and it is not the community
feed.

Interaction rules:

- the page must be usable without a Murmur session
- the primary action is listening to the song
- the growth CTA is creating a new song from the listener's own hum
- the page may expose copy-link and future remix/follow affordances, but not
  edit, delete, billing, debug, or owner-only export controls
- unlisted links should feel shareable but private-by-default: no community
  badges, no crawler indexing, no public discovery copy
- public links may later show creator/community context, but that should be
  additive and keyed off `visibility = public`

Implementation boundaries:

- `/song/[id]` remains the owner page. It can generate/copy the share link.
- `/api/songs/[id]/share` owns share-code allocation and visibility changes to
  `unlisted` or `public`.
- `/api/public/songs/[shareCode]` returns only the playback payload needed by
  the public page. Demo shares must remain independent of the song query layer
  so a database or migration issue cannot take the basic public-share route
  offline.
- future search/community surfaces should query public songs through DB query
  helpers instead of changing the unlisted playback contract.

Follow-up product plan:

1. Add a small owner-side visibility control once privacy editing exists:
   private, link-only, public.
2. Move public playback audio to `mp3Url`/object storage as the default, keeping
   `mp3DataUrl` only as a legacy fallback.
3. Introduce community/search on top of `visibility = public`, with moderation
   and reporting before broad discovery.
