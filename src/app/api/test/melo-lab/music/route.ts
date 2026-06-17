import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { CleanMelody } from "@/modules/shared/types";
import { meloLabGate, resolveLocalWorkerUrl } from "@/lib/test/melo-lab";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_HUM_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 300;

const noteSchema = z.object({
  pitch: z.number(),
  start: z.number(),
  duration: z.number(),
  velocity: z.number().optional(),
  confidence: z.number().optional(),
});

const melodySchema = z.object({
  notes: z.array(noteSchema),
  key: z.string(),
  scale: z.enum(["major", "minor", "pentatonic", "dorian", "phrygian"]),
  bpm: z.number(),
  duration: z.number(),
  contour: z.enum(["rising", "falling", "wave", "flat"]),
});

/**
 * TEST ONLY: POST /api/test/melo-lab/music
 *
 * Local music-engine probe. It never calls RunPod/serverless; the route only
 * accepts a localhost MUSIC worker so final-output drift can be diagnosed on
 * one machine.
 */
export async function POST(request: NextRequest) {
  const gate = meloLabGate(request.headers.get("host"));
  if (!gate.ok) {
    return NextResponse.json(
      { error: "melo_lab_disabled", message: "Melo-lab is local/test only." },
      { status: 404 },
    );
  }

  const workerBase = resolveLocalWorkerUrl(
    process.env.MELO_LAB_MUSIC_WORKER_URL || process.env.MUSIC_WORKER_URL,
    "http://127.0.0.1:8002",
  );
  if (!workerBase) {
    return NextResponse.json(
      {
        error: "local_music_worker_required",
        message: "Set MELO_LAB_MUSIC_WORKER_URL or MUSIC_WORKER_URL to a localhost worker.",
      },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const promptRaw = formData.get("prompt");
    const prompt = typeof promptRaw === "string" ? promptRaw.trim() : "";
    if (!prompt) {
      return NextResponse.json(
        { error: "prompt_required", message: "Prompt is required." },
        { status: 400 },
      );
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return NextResponse.json(
        { error: "validation_error", message: "Prompt is too long." },
        { status: 400 },
      );
    }

    const melodyRaw = formData.get("melody");
    const melodyText = typeof melodyRaw === "string" ? melodyRaw.trim() : "";
    const melody = parseMelody(melodyText);

    const durationRaw = Number(formData.get("duration") ?? 10);
    const duration = Math.min(
      20,
      Math.max(2, Number.isFinite(durationRaw) ? durationRaw : 10),
    );

    const styleMixRaw = Number(formData.get("styleMix") ?? 0);
    const styleMix = Math.min(
      0.8,
      Math.max(0, Number.isFinite(styleMixRaw) ? styleMixRaw : 0),
    );

    const humValue = formData.get("hum");
    const hum = humValue instanceof File && humValue.size > 0 ? humValue : null;
    if (hum && hum.size > MAX_HUM_BYTES) {
      return NextResponse.json(
        { error: "hum_too_large", message: "Hum file must be 8 MB or smaller." },
        { status: 413 },
      );
    }

    const workerForm = new FormData();
    workerForm.append("prompt", prompt);
    workerForm.append("duration", String(duration));
    workerForm.append("melody", JSON.stringify(melody));
    if (hum && styleMix > 0) {
      workerForm.append("style_mix", String(styleMix));
      workerForm.append("hum", hum, hum.name || "hum.webm");
    }

    const headers = new Headers({
      "X-Request-Id": request.headers.get("x-request-id") || crypto.randomUUID(),
    });
    const token = process.env.MUSIC_WORKER_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const workerResponse = await fetch(`${workerBase}/generate`, {
      method: "POST",
      body: workerForm,
      headers,
      signal: AbortSignal.timeout(110_000),
    });

    if (!workerResponse.ok) {
      return NextResponse.json(
        {
          error: "music_worker_failed",
          message: `Local music worker returned HTTP ${workerResponse.status}`,
          detail: await readJsonSafely(workerResponse),
        },
        { status: 502 },
      );
    }

    return new NextResponse(await workerResponse.arrayBuffer(), {
      headers: {
        "Content-Type": workerResponse.headers.get("content-type") ?? "audio/wav",
        "Cache-Control": "no-store",
        "X-Melo-Lab": "test-only",
        "X-Model": workerResponse.headers.get("x-model") ?? "",
        "X-Generation-Ms": workerResponse.headers.get("x-generation-ms") ?? "",
        "X-Style-Mix": workerResponse.headers.get("x-style-mix") ?? "",
        "X-Melody-Conditioned":
          workerResponse.headers.get("x-melody-conditioned") ?? "",
        "X-Cfg-Notes": workerResponse.headers.get("x-cfg-notes") ?? "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "melo_lab_music_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function parseMelody(value: string): CleanMelody {
  if (!value) {
    throw new Error("melody is required");
  }
  return melodySchema.parse(JSON.parse(value)) as CleanMelody;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
