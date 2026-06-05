import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import postgres from "postgres";

config({ path: ".env" });

const runMigrate = async () => {
  const client = postgres(
    process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/myapp",
    { max: 1 }
  );
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
