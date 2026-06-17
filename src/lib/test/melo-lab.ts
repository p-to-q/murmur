import type { CleanMelody, MelodyNote } from "@/modules/shared/types";

export type MeloLabStage = "raw" | "intent" | "corrected" | "musical";

export type MeloLabLocalGate = {
  ok: boolean;
  reason: "local" | "enabled" | "loopback" | "disabled";
};

/**
 * Melo-lab is a test-only local diagnostic surface. It is available in local
 * development by default, or in an explicit production diagnostic build when
 * MURMUR_ENABLE_MELO_LAB=1.
 */
export function meloLabGate(host?: string | null): MeloLabLocalGate {
  if (process.env.MURMUR_ENABLE_MELO_LAB === "1") {
    return { ok: true, reason: "enabled" };
  }
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, reason: "local" };
  }
  if (isLoopbackHost(host)) {
    return { ok: true, reason: "loopback" };
  }
  return { ok: false, reason: "disabled" };
}

export function resolveLocalWorkerUrl(
  explicit: string | undefined,
  fallback: string,
): string | null {
  const value = (explicit || fallback).trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!isLocalHostname(url.hostname)) return null;
    return value.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function summarizeMelody(melody: CleanMelody) {
  const notes = melody.notes;
  return {
    noteCount: notes.length,
    key: melody.key,
    scale: melody.scale,
    bpm: Math.round(melody.bpm),
    duration: round(melody.duration),
    contour: melody.contour,
    pitchRange:
      notes.length > 0
        ? `${Math.min(...notes.map((note) => note.pitch))}-${Math.max(...notes.map((note) => note.pitch))}`
        : "none",
    averageConfidence:
      notes.length > 0
        ? round(notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length)
        : null,
  };
}

export function melodyNotesAsCsv(notes: MelodyNote[]): string {
  const rows = ["index,pitch,start,duration,velocity,confidence"];
  notes.forEach((note, index) => {
    rows.push(
      [
        index,
        note.pitch,
        round(note.start),
        round(note.duration),
        round(note.velocity),
        round(note.confidence),
      ].join(","),
    );
  });
  return rows.join("\n");
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  const bracketedIpv6 = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  const hostname = bracketedIpv6?.[1] ?? trimmed.split(":")[0];
  return isLocalHostname(hostname);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
