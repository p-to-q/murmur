import { describe, expect, it } from "bun:test";
import { nextNotesRefillAt } from "@/lib/billing/notes-clock";

describe("user balance route helpers", () => {
  it("returns the next midnight at UTC+8", () => {
    expect(nextNotesRefillAt(new Date("2026-06-03T15:30:00.000Z")).toISOString())
      .toBe("2026-06-03T16:00:00.000Z");
    expect(nextNotesRefillAt(new Date("2026-06-03T16:01:00.000Z")).toISOString())
      .toBe("2026-06-04T16:00:00.000Z");
  });
});
