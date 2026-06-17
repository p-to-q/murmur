"use client";

import type { CleanMelody } from "@/modules/shared/types";
import {
  type MeloLabPitchProviderId,
  type MeloLabTranscribeResponse,
} from "@/lib/test/melo-lab-contract";

export type MeloLabProviderRun =
  | {
      provider: MeloLabPitchProviderId;
      status: "ready";
      response: MeloLabTranscribeResponse;
      elapsedMs: number;
    }
  | {
      provider: MeloLabPitchProviderId;
      status: "error";
      error: string;
      elapsedMs: number;
    };

export type MeloLabMusicRequest = {
  prompt: string;
  durationSeconds: number;
  styleMix: number;
  melody: CleanMelody;
  hum?: Blob | null;
};

export type MeloLabMusicResponse = {
  blob: Blob;
  model: string | null;
  generationMs: string | null;
  melodyConditioned: string | null;
  cfgNotes: string | null;
};

export async function transcribeMeloLabProvider(
  blob: Blob,
  provider: MeloLabPitchProviderId,
): Promise<MeloLabProviderRun> {
  const startedAt = performance.now();
  const form = new FormData();
  form.append("audio", blob, filenameForBlob(blob));
  form.append("targetInstrument", "piano");
  form.append("pitchProvider", provider);

  try {
    const response = await fetch("/api/test/melo-lab/transcribe", {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, response.status));
    }
    return {
      provider,
      status: "ready",
      response: payload as MeloLabTranscribeResponse,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } catch (err) {
    return {
      provider,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}

export async function generateMeloLabMusic(
  request: MeloLabMusicRequest,
): Promise<MeloLabMusicResponse> {
  const form = new FormData();
  form.append("prompt", request.prompt);
  form.append("duration", String(request.durationSeconds));
  form.append("styleMix", String(request.styleMix));
  form.append("melody", JSON.stringify(request.melody));
  if (request.hum && request.styleMix > 0) {
    form.append("hum", request.hum, filenameForBlob(request.hum));
  }

  const response = await fetch("/api/test/melo-lab/music", {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as unknown;
    throw new Error(errorMessageFromPayload(payload, response.status));
  }

  return {
    blob: await response.blob(),
    model: response.headers.get("x-model"),
    generationMs: response.headers.get("x-generation-ms"),
    melodyConditioned: response.headers.get("x-melody-conditioned"),
    cfgNotes: response.headers.get("x-cfg-notes"),
  };
}

export function filenameForBlob(blob: Blob): string {
  if (blob.type.includes("webm")) return "hum.webm";
  if (blob.type.includes("mp4") || blob.type.includes("m4a")) return "hum.m4a";
  if (blob.type.includes("wav")) return "hum.wav";
  return "hum.audio";
}

function errorMessageFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (record.detail && typeof record.detail === "object") {
      const detail = record.detail as Record<string, unknown>;
      if (typeof detail.message === "string") return detail.message;
      if (typeof detail.error === "string") return detail.error;
    }
  }
  return `HTTP ${status}`;
}
