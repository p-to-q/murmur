const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nextNotesRefillAt(now = new Date()): Date {
  return new Date(currentNotesRefillWindowStart(now).getTime() + DAY_MS);
}

export function currentNotesRefillWindowStart(now = new Date()): Date {
  const cnNow = new Date(now.getTime() + CHINA_UTC_OFFSET_MS);
  const cnMidnight = Date.UTC(
    cnNow.getUTCFullYear(),
    cnNow.getUTCMonth(),
    cnNow.getUTCDate(),
  );
  return new Date(cnMidnight - CHINA_UTC_OFFSET_MS);
}

export function notesRefillWindowKey(now = new Date()): string {
  const cnNow = new Date(now.getTime() + CHINA_UTC_OFFSET_MS);
  const year = cnNow.getUTCFullYear();
  const month = String(cnNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(cnNow.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
