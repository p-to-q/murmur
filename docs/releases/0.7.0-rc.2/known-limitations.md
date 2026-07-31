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
  a tested 24-hour lifecycle for `tmp/`; release stays NO-GO without evidence.
- Private song-master writes require bucket/CDN enforcement in addition to the
  application flag; adapter `scope` metadata is not an ACL.
- Object-store delivery currently materializes one structurally validated,
  8 MiB-bounded master in the Function. Native ranged storage reads or signed
  URLs remain a later scaling optimization.
- Production smoke requires durable owner/share audio fixtures and remains read-
  only. Final release evidence still requires one human browser flow.
- The strict Preview environment contract currently blocks the Vercel Preview
  for the environment-gate and release PRs. The detailed Vercel build log is
  private to the project scope; an owner must correct the real Preview resource
  configuration and produce a green final-stack deployment before release.
- Protected credential migration, real production database/provider evidence,
  the final human listen, merge order, and exact-SHA Pre-release are tracked in
  release-blocker issue #445. Do not replace those receipts with placeholders.
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
  anonymous. Release requires an approved purpose, least-privilege access,
  retention schedule, and final deletion/anonymization policy; these rows are
  excluded from training exports.
