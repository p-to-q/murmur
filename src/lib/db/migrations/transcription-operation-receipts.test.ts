import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const up = readFileSync(
  path.join(import.meta.dir, "0034_transcription_operation_receipts.sql"),
  "utf8",
);
const down = readFileSync(
  path.join(import.meta.dir, "0034_transcription_operation_receipts.down.sql"),
  "utf8",
);
const journal = JSON.parse(readFileSync(
  path.join(import.meta.dir, "meta/_journal.json"),
  "utf8",
)) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("0034 transcription operation receipts migration", () => {
  test("adds one expand-only receipt table with leasing and ownership constraints", () => {
    expect(up).toContain('CREATE TABLE "transcription_operations"');
    expect(up).toContain(
      'CONSTRAINT "transcription_operations_pkey" PRIMARY KEY("user_id", "operation_id")',
    );
    expect(up).toContain(
      'CONSTRAINT "transcription_operations_user_id_users_id_fk"',
    );
    expect(up).toContain('ON DELETE cascade ON UPDATE no action');
    expect(up).toContain(
      'CONSTRAINT "transcription_operations_spend_ledger_id_notes_ledger_id_fk"',
    );
    expect(up).toContain('ON DELETE set null ON UPDATE no action');
    expect(up).toContain('CREATE INDEX "transcription_operations_status_lease_idx"');
    expect(up).toContain('USING btree ("status", "lease_until")');

    expect(up).not.toMatch(/^\s*(?:DROP|DELETE\s+FROM|TRUNCATE)\b/im);
    expect(up).not.toMatch(/ALTER TABLE\s+"(?!transcription_operations")/i);
  });

  test("has a bounded rollback and is the registered migration 0034", () => {
    expect(down.trim()).toBe('DROP TABLE IF EXISTS "transcription_operations";');
    const previousEntry = journal.entries.at(-2);
    const currentEntry = journal.entries.at(-1);

    expect(previousEntry).toMatchObject({
      idx: 33,
      tag: "0033_music_jobs_next_run_default",
    });
    expect(currentEntry).toMatchObject({
      idx: 34,
      tag: "0034_transcription_operation_receipts",
    });
    expect(currentEntry!.when).toBeGreaterThan(previousEntry!.when);
  });
});
