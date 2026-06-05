const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nextNotesRefillAt(now = new Date()): Date {
  const cnNow = new Date(now.getTime() + CHINA_UTC_OFFSET_MS);
  const cnMidnight = Date.UTC(
    cnNow.getUTCFullYear(),
    cnNow.getUTCMonth(),
    cnNow.getUTCDate(),
  );
  return new Date(cnMidnight + DAY_MS - CHINA_UTC_OFFSET_MS);
}
