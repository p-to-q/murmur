const SHARE_CODE_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyz";
const SHARE_CODE_LENGTH = 10;
const SHARE_CODE_RE = /^[23456789abcdefghijkmnopqrstuvwxyz]{10}$/;

export type SongShareVisibility = "unlisted" | "public";

export function createSongShareCode(): string {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length])
    .join("");
}

export function normalizeSongShareVisibility(value: unknown): SongShareVisibility {
  return value === "public" ? "public" : "unlisted";
}

export function isSongShareVisibility(value: unknown): value is SongShareVisibility {
  return value === "unlisted" || value === "public";
}

export function hasSongShareAudio(song: {
  mp3DataUrl?: unknown;
  mp3Url?: unknown;
}): boolean {
  return isNonEmptyString(song.mp3DataUrl) || isNonEmptyString(song.mp3Url);
}

export function isSongShareCode(value: unknown): value is string {
  return typeof value === "string" && SHARE_CODE_RE.test(value);
}

export function normalizeSongShareCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return isSongShareCode(normalized) ? normalized : null;
}

export function buildSongShareUrl(origin: string, shareCode: string): string {
  const base = origin.replace(/\/+$/, "");
  return new URL(`/s/${encodeURIComponent(shareCode)}`, base).toString();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
