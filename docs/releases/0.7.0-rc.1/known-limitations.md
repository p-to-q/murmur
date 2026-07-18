# 0.7.0-rc.1 Known Limitations

- Durable music jobs are Phase 1 and client-polled. An independent dispatcher,
  stale-job alerting, and full production cutover remain tracked in issue #408.
- The Vercel dashboard setting that disables native Production auto-deploy is
  external to this repository and must be verified before merge/release (#307).
- The Studio-skip and canonical-draft-first choices are isolated experiments,
  default off, and not product behavior in this candidate.
- Production smoke is read-only. It does not spend Notes or execute a real
  payment transaction.
