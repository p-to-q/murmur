import { StorageError } from "./types";

/**
 * Canonical asset kinds Murmur stores. Each kind maps to a folder
 * prefix so an operator inspecting a bucket can tell what a stray
 * object is for. New kinds added here must also be reviewed in the
 * `docs/data-model.md` storage section.
 */
export type ObjectKind =
  | "song-master" // rendered mp3/m4a returned to the user
  | "song-poster" // social-preview PNG
  | "share-html" // pre-rendered share page HTML
  | "quality-sample" // opt-in audio captured for quality analysis
  | "tmp"; // ephemeral; should carry a ttlSeconds

const KIND_TO_PREFIX: Record<ObjectKind, string> = {
  "song-master": "songs/master",
  "song-poster": "songs/poster",
  "share-html": "shares",
  "quality-sample": "quality",
  tmp: "tmp",
};

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;

const SHARED_USER_SENTINEL = "_shared";
const NO_SONG_SENTINEL = "_";

export interface ObjectKeyInput {
  kind: ObjectKind;
  /** Owning user; required for everything except shared/public posters. */
  userId?: string;
  /** Owning song; optional for kinds that aren't song-scoped (e.g. tmp). */
  songId?: string;
  /** Stable id for this specific asset (ulid recommended). */
  id: string;
  /** Lowercase, no dot. e.g. "mp3", "png", "html", "webm". */
  ext: string;
}

/**
 * Build a canonical, redaction-safe object key.
 *
 * Shape:
 *   <kind-prefix>/<userId|_shared>/<songId|_>/<id>.<ext>
 *
 * Only externally supplied segments (userId / songId / id) are validated
 * against the SEGMENT_RE charset; the literal sentinels `_shared` and
 * `_` are internal markers and bypass the regex.
 */
export function objectKey(input: ObjectKeyInput): string {
  const prefix = KIND_TO_PREFIX[input.kind];
  if (!prefix) {
    throw new StorageError("invalid_key", `Unknown ObjectKind: ${input.kind}`);
  }

  const user = validateExternalSegment(input.userId, SHARED_USER_SENTINEL, "userId");
  const song = validateExternalSegment(input.songId, NO_SONG_SENTINEL, "songId");
  validateExternalSegmentStrict(input.id, "id");

  if (!EXT_RE.test(input.ext)) {
    throw new StorageError(
      "invalid_key",
      `Invalid extension: ${JSON.stringify(input.ext)}`,
    );
  }

  return `${prefix}/${user}/${song}/${input.id}.${input.ext}`;
}

function validateExternalSegment(
  raw: string | undefined,
  fallback: string,
  label: string,
): string {
  if (raw === undefined) return fallback;
  validateExternalSegmentStrict(raw, label);
  return raw;
}

function validateExternalSegmentStrict(value: string, label: string): void {
  if (!SEGMENT_RE.test(value)) {
    throw new StorageError(
      "invalid_key",
      `Invalid ${label} segment: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Defensive check used by adapters before opening a file path or
 * issuing a remote request. Refuses leading slashes, parent traversal,
 * NUL bytes, and anything outside our allow-list charset.
 */
export function assertValidKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
    throw new StorageError("invalid_key", "Key must be a non-empty string ≤ 1024 chars");
  }
  if (key.startsWith("/") || key.includes("..") || key.includes("\0")) {
    throw new StorageError("invalid_key", `Unsafe key: ${JSON.stringify(key)}`);
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) {
    throw new StorageError("invalid_key", `Key contains disallowed chars: ${JSON.stringify(key)}`);
  }
}
