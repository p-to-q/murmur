import { pgTable, text, varchar, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id:        text("id").primaryKey(),
    email:     varchar("email", { length: 256 }).notNull(),
    code:      varchar("code", { length: 6 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt:    timestamp("used_at"),
    attempts:  integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byEmailCode: index("evc_email_code_idx").on(t.email, t.code),
    byExpiry:    index("evc_expires_at_idx").on(t.expiresAt),
  }),
);

export type EmailVerificationCode = InferSelectModel<typeof emailVerificationCodes>;
