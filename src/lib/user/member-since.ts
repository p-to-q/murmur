import { decodeTime, isValid } from "ulid";

/** Best-effort join date from a ULID user id; null for guest/local ids. */
export function memberSinceFromUserId(userId: string): Date | null {
  try {
    if (!isValid(userId)) return null;
    return new Date(decodeTime(userId));
  } catch {
    return null;
  }
}

export function formatMemberSince(
  userId: string,
  locale: "zh" | "en",
): string | null {
  const joined = memberSinceFromUserId(userId);
  if (!joined) return null;
  return joined.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
  });
}
