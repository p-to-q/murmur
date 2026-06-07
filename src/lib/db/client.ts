import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env" });

// Vercel provides POSTGRES_URL, others might use DATABASE_URL
const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgresql://postgres:password@localhost:5432/myapp";

const client = postgres(connectionString);

export const db = drizzle(client);
