# 0.7.0-rc.2 Known Limitations

- The signal-quality Gate catches technical failure, not subjective musicality.
  Frozen-dataset scores and human pairwise preference remain required before
  tuning or claiming stronger musical output.
- Durable music jobs require a minute-cadence trusted scheduler. Vercel Hobby
  only supports daily cron, so the client flag remains off without an external
  scheduler and real RunPod canary.
- Song-audio cleanup requires an external 15-minute scheduler for the stated
  recovery SLA. The daily Vercel cron is only a safety net.
- S3-compatible adapters do not implement TTL deletion. The bucket must enforce
  a tested 24-hour lifecycle for `tmp/`. Production configuration was confirmed
  for rc.2; replacement buckets or credentials must be re-verified.
- Private song-master writes require bucket/CDN enforcement in addition to the
  application flag; adapter `scope` metadata is not an ACL.
- Object-store delivery currently materializes one structurally validated,
  8 MiB-bounded master in the Function. Native ranged storage reads or signed
  URLs remain a later scaling optimization.
- Production smoke requires durable owner/share audio fixtures and remains read-
  only. The rc.2 release captain also recorded the live Save -> Gallery -> Play
  -> Download -> Share -> Public play -> Revoke flow; future releases must
  repeat it and should retain independently replayable evidence.
- A green PR Preview proves build safety and exact deployment provenance, but an
  unprovisioned Preview may still lack its bucket or Worker credentials and will
  fail closed on those runtime routes. Before using Preview as release evidence,
  provision its isolated resources, set `MURMUR_PREVIEW_REQUIRE_FULL_STACK=1`,
  and pass the protected Vercel resource-isolation preflight.
- Protected credential migration, production database/provider evidence, merge
  order, and the exact-SHA Pre-release are recorded in closed issue #455. The
  remaining human musicality decision is tracked separately in issue #201.
- The pinned 8-case HumTrans `auto` run passes quality acceptance, but its one
  local p95 latency observation is 1303.45 ms. Repeated CI measurement and
  performance work are tracked in non-blocking issue #446.
- The service worker handles Push only. Offline creation, Gallery playback, and
  an offline application shell are not supported in this candidate.
- Legacy OAuth Push rows without a Murmur session remain non-deliverable until
  that browser signs in and automatically rebinds its endpoint. Release schema
  verification reports the remaining count; rc.2 deliberately does not disable
  those rows or add a rollback-incompatible non-null constraint.
- Billing/refund rows retained after account cleanup remain pseudonymous, not
  anonymous. They require an approved purpose, least-privilege access, retention
  schedule, and final deletion/anonymization policy; these rows are excluded
  from training exports.
