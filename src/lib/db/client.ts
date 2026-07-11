import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env" });

// Vercel provides POSTGRES_URL, others might use DATABASE_URL
const configured = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

// In production a missing DSN must fail loudly at first use, not silently
// dial a localhost dev database and surface as confusing connection errors.
// (Build-time module evaluation is exempt — Vercel injects env at runtime.)
if (
  !configured &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  throw new Error(
    "DATABASE_URL / POSTGRES_URL is not set — refusing to start without a database in production",
  );
}

const connectionString =
  configured ?? "postgresql://postgres:password@localhost:5432/myapp";

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
// `DATABASE_URL` at the `-pooler.neon.tech` host in production so PgBouncer
// multiplexes many client connections onto a small backend pool, decoupling
// instance count from the backend limit. Only lower `max` if you have a
// concrete reason to (and re-check the invariant above if you raise it).
const client = postgres(connectionString, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client);
