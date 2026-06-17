import type { CleanMelody, MelodyNote } from "@/modules/shared/types";
import {
  MELO_LAB_PITCH_PROVIDER_IDS,
  MELO_LAB_STAGE_IDS,
  type MeloLabPitchProviderId,
  type MeloLabStageId,
} from "@/lib/test/melo-lab-contract";

export type MeloLabLocalGate = {
  ok: boolean;
  reason: "local" | "enabled" | "disabled";
};

/**
 * Melo-lab is a test-only local diagnostic surface. It is available in local
 * development by default, or in an explicit diagnostic build when
 * MURMUR_ENABLE_MELO_LAB=1. The risky part stays isolated in the test APIs:
 * they only call loopback workers and never touch billing or remote workers.
 */
export function meloLabGate(): MeloLabLocalGate {
  if (process.env.MURMUR_ENABLE_MELO_LAB === "1") {
    return { ok: true, reason: "enabled" };
  }
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, reason: "local" };
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

export function isLoopbackHostname(hostname: string | undefined | null): boolean {
  const normalized = (hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function isMeloLabPitchProvider(
  value: string,
): value is MeloLabPitchProviderId {
  return MELO_LAB_PITCH_PROVIDER_IDS.includes(value as MeloLabPitchProviderId);
}

export function isMeloLabStage(value: string): value is MeloLabStageId {
  return MELO_LAB_STAGE_IDS.includes(value as MeloLabStageId);
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
  return isLoopbackHostname(hostname);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
