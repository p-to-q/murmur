import { describe, expect, it } from "bun:test";
import {
  currentNotesRefillWindowStart,
  nextNotesRefillAt,
  notesRefillWindowKey,
} from "./notes-clock";

describe("notes refill clock", () => {
  it("uses Asia/Shanghai midnight, not UTC midnight, as the daily boundary", () => {
    const beforeChinaMidnight = new Date("2026-07-17T15:59:59.999Z");
    const afterChinaMidnight = new Date("2026-07-17T16:00:00.000Z");

    expect(notesRefillWindowKey(beforeChinaMidnight)).toBe("2026-07-17");
    expect(notesRefillWindowKey(afterChinaMidnight)).toBe("2026-07-18");
    expect(currentNotesRefillWindowStart(beforeChinaMidnight).toISOString())
      .toBe("2026-07-16T16:00:00.000Z");
    expect(currentNotesRefillWindowStart(afterChinaMidnight).toISOString())
      .toBe("2026-07-17T16:00:00.000Z");
  });

  it("returns the next Asia/Shanghai refill instant across UTC date changes", () => {
    expect(nextNotesRefillAt(new Date("2026-07-17T00:01:00.000Z")).toISOString())
      .toBe("2026-07-17T16:00:00.000Z");
    expect(nextNotesRefillAt(new Date("2026-07-17T23:30:00.000Z")).toISOString())
      .toBe("2026-07-18T16:00:00.000Z");
  });

  it("keeps year rollover keys aligned to the China calendar day", () => {
    expect(notesRefillWindowKey(new Date("2026-12-31T15:59:59.999Z")))
      .toBe("2026-12-31");
    expect(notesRefillWindowKey(new Date("2026-12-31T16:00:00.000Z")))
      .toBe("2027-01-01");
  });
});
