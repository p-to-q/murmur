const SHORT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_SHORT_ID = "LOCAL";

function normalizeSegment(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

function deriveShortId(requestId: string | null): string {
  if (!requestId) return DEFAULT_SHORT_ID;

  const raw = requestId.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!raw) return DEFAULT_SHORT_ID;

  let hash = 0;
  for (const ch of raw) {
    hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  }

  let out = "";
  let state = hash || 0x9e3779b9;
  for (let i = 0; i < 6; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += SHORT_ID_ALPHABET[state % SHORT_ID_ALPHABET.length] ?? "X";
  }
  return out;
}

export function formatSupportCode(args: {
  area: string;
  error: string;
  requestId: string | null;
}): string {
  const area = normalizeSegment(args.area);
  const error = normalizeSegment(args.error);
  const shortId = deriveShortId(args.requestId);
  return `${area}-${error}-${shortId}`;
}

export function formatHumSupportCode(args: {
  code: string;
  requestId: string | null;
}): string {
  return formatSupportCode({
    area: "HUM",
    error: args.code,
    requestId: args.requestId,
  });
}

export function formatVibeSupportCode(args: {
  code: string;
  requestId: string | null;
}): string {
  return formatSupportCode({
    area: "VIBE",
    error: args.code,
    requestId: args.requestId,
  });
}

export function formatStudioSupportCode(args: {
  code: string;
  requestId: string | null;
}): string {
  return formatSupportCode({
    area: "STUDIO",
    error: args.code,
    requestId: args.requestId,
  });
}

export function formatShareSupportCode(args: {
  code: string;
  requestId: string | null;
}): string {
  return formatSupportCode({
    area: "SHARE",
    error: args.code,
    requestId: args.requestId,
  });
}
