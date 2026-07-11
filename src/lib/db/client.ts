import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { isExplicitLocalDev, resolveDbPoolMax, resolveServerDsn } from "./config";

config({ path: ".env" });

// One fail-closed DSN resolver, shared with the migration script (issue #316).
// In production a missing DSN throws loudly at first use instead of silently
// dialing a localhost dev database and surfacing as confusing connection errors.
// The Next.js build phase is exempt from the throw: Vercel evaluates modules
// before injecting runtime env, so an absent DSN there is expected.
const buildPhase = process.env.NEXT_PHASE === "phase-production-build";
const connectionString = resolveServerDsn(process.env, {
  isExplicitLocalDev: isExplicitLocalDev(process.env) || buildPhase,
});

// Explicit pool bounds for serverless: the postgres-js defaults (max 10,
// idle connections held forever) let every warm lambda instance pin ten
// connections against the Neon pooler. A single instance rarely needs more
// than a few, and idle ones should be released instead of held for the
// instance's lifetime.
//
// Connection-budget invariant (issue #235):
//   peak_serverless_instances × max  <  neon_connection_limit
// Each warm Vercel instance opens up to `max` backend connections. With
// `max: 5`, 20 concurrent warm instances = 100 connections — already at the
// Neon Pro ceiling and well past Neon Free's 20. The durable fix is NOT a
// smaller `max` but routing through Neon's connection pooler: point
// `DATABASE_URL` at the `-pooler.<region>.neon.tech` host in production so
// PgBouncer multiplexes many client connections onto a small backend pool,
// decoupling instance count from the backend limit. Only lower `max` if you have a
// concrete reason to. `MURMUR_DB_POOL_MAX` allows bounded production load-test
// tuning without changing the default; re-check the invariant above before
// raising it.
const client = postgres(connectionString, {
  max: resolveDbPoolMax(),
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client);
