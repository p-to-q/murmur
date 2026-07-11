import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { isExplicitLocalDev, resolveServerDsn } from "./src/lib/db/config";

config({ path: ".env" });

// Drizzle Kit (generate / migrate / studio / push) is migration tooling, so it
// shares the one fail-closed resolver (issue #316): prefer the explicit unpooled
// endpoint, accept the documented POSTGRES_URL fallback, and refuse to silently
// target localhost outside explicit local development.
const databaseUrl = resolveServerDsn(process.env, {
  isMigration: true,
  isExplicitLocalDev: isExplicitLocalDev(process.env),
});

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
