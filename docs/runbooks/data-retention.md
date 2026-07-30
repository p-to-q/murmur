# Data Retention and Disposal

This runbook records what Murmur retains, who owns deletion, and which evidence
is required before release. It is an engineering control, not a substitute for
an approved legal or finance retention policy.

## Browser recovery data

- Last recording and generated recovery clips stop restoring after 24 hours.
- Unsaved creation drafts stop restoring after seven days.
- The next app start/access performs a best-effort sweep. A closed browser does
  not run timers, so these durations are recovery limits, not guaranteed wall-
  clock physical deletion.
- Successful logout/account deletion attempts every account-scoped cleanup and
  records failures without rolling back a successful server-side exit.
- Language, theme, currency, and audio preferences are device preferences and
  remain until the user or browser clears them.

## Service data

- Accepted raw hum objects use private `tmp/` keys. The bucket owns their
  physical 24-hour expiry; application TTL metadata is not proof of deletion.
- Saved masters remain until song/account lifecycle logic marks their durable
  receipts for deletion and the song-audio reconciler confirms object removal.
- Account deletion revokes access immediately and purges creative/identity data
  and referenced objects after the documented 30-day window.

## Restricted financial records

The user tombstone, purchases, and Notes ledger retained after creative-data
purge contain stable internal/provider references. They are pseudonymous and
remain sensitive. They are available only to server billing/refund paths and
approved operators; they must never enter model-training exports.

Before a release can be marked GO, the release evidence must name:

1. the approved billing/refund and compliance purpose;
2. the operator roles allowed to access these rows and where access is audited;
3. the retention schedule and responsible owner;
4. the final deletion or irreversible-anonymization action;
5. the approval date and next review date.

Do not erase or transform provider references in a product patch before the
refund/reconciliation contract and the approved retention policy agree. Until
that decision is recorded, the release remains NO-GO.

## Release evidence

- Vercel Preview/Production resource isolation audit receipt;
- `tmp/` canary creation and observed lifecycle deletion time;
- account deletion job and object reconciler completion receipt;
- browser exit cleanup failure/success observability receipt;
- approved restricted-financial-record decision above.
