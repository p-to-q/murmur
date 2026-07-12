# Remove side-nav active-row wash
Status: accepted
Date: 2026-07-12
Owners: @dujiayi

## Context

PR a5717dd9 introduced an "active-row wash" — a `bg-[#FF5924]/[0.07]`
rounded-[12px] overlay that covered the entire active destination row in the
desktop side navigation (Create / Gallery / Me). The intent was to give the
active item a "clear-but-quiet zone" that glides between destinations via
Framer Motion `layoutId`.

## Decision

Remove the active-row wash entirely. The left-edge marker
(`side-nav-active-marker`, a 4px × 36px coral bar at `-left-7`) combined
with the text style shift (serif italic, larger size) is sufficient visual
affordance for the active destination.

Users on sight reported the light orange backdrop as distracting — it added
visual weight without conveying information that the left-edge marker
doesn't already convey.

## Alternatives considered

- **Lower opacity** — `bg-[#FF5924]/[0.04]` was tried but the wash was
  still perceptible and still felt like unnecessary paint.
- **Different color** — Gray or beige variants reduced the "orange patch"
  complaint but also made the active state harder to distinguish from hover.

## Consequences

- Active state remains clearly indicated: left-edge orange bar + serif
  italic text styling.
- Side nav renders one fewer animated element (minor rendering perf gain).
- The `layoutId="side-nav-active-bg"` Framer Motion animation is removed;
  the remaining `side-nav-active-marker` still provides a smooth slide
  between destinations.

## Migration and rollback

The change is pure deletion with no migration. To roll back, revert the
hunk that removes the wash and restore the `{isActive && !collapsed &&
<motion.span layoutId="side-nav-active-bg" ...>` block in
`side-nav.tsx`.

## Verification

1. Open the desktop side nav at 320 px (expanded).
2. Navigate between Create, Gallery, and Me.
3. Each active item shows a 4px coral left-edge bar + italic text. No
   orange backdrop covers the row.
