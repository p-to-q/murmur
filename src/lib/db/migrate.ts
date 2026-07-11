import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import postgres from "postgres";

import { isExplicitLocalDev, resolveServerDsn } from "./config";

config({ path: ".env" });

const runMigrate = async () => {
  // Same fail-closed DSN resolver the runtime client uses (issue #316), in
  // MIGRATION mode: it prefers the explicit unpooled endpoint
  // (DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING) and accepts the
  // documented POSTGRES_URL fallback. When no DSN is set it throws a clear
  // error instead of silently targeting localhost and migrating the wrong DB.
  const connectionString = resolveServerDsn(process.env, {
    isMigration: true,
    isExplicitLocalDev: isExplicitLocalDev(process.env),
  });
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("⏳ Running migrations...");

  const start = Date.now();
  const migrationsFolder = path.join(process.cwd(), "src/lib/db/migrations");
  await migrate(db, { migrationsFolder });
  const end = Date.now();

  console.log("✅ Migrations completed in", end - start, "ms");
  await client.end();
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed");
  const refused =
    (err && typeof err === "object" && "code" in err && err.code === "ECONNREFUSED") ||
    (err &&
      typeof err === "object" &&
      "cause" in err &&
      err.cause &&
      typeof err.cause === "object" &&
      "code" in err.cause &&
      err.cause.code === "ECONNREFUSED");
  if (refused) {
    console.error(
      "Postgres is not reachable. Start the local DB with `bun run db:up` after Docker Desktop is running.",
    );
  }
  console.error(err);
  process.exit(1);
});
