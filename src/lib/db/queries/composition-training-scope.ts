export function normalizeConsentedUserIds(userIds: string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))].slice(0, 500);
}
