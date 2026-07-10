import type { MelodyNote, TranscriptionInput, TranscriptionResult } from "@/modules/shared/types";
import { polishMelody } from "@/modules/music/melody-polisher";
import { getRemotePythonWorkerUrl } from "../runtime";

/** Remote Python Basic Pitch worker provider */
export async function transcribeRemotePython(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  if (!input.audioBlob) {
    throw new Error("Remote Python provider requires an audio blob");
  }

  const workerBase = getRemotePythonWorkerUrl();
  if (!workerBase) {
    throw new Error(
      "Remote Python provider disabled: NEXT_PUBLIC_BASIC_PITCH_WORKER_URL is not configured",
    );
  }

  const form = new FormData();
  form.append("audio", input.audioBlob, "hum.wav");

  const workerUrl = workerBase.endsWith("/transcribe")
    ? workerBase
    : `${workerBase}/transcribe`;

  const res = await fetch(workerUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`Remote worker HTTP ${res.status}`);

  const data = (await res.json()) as {
    notes?: Array<{
      pitch: number;
      start: number;
      duration: number;
      velocity?: number;
      confidence?: number;
    }>;
  };

  if (!data.notes?.length) throw new Error("Remote worker returned empty notes");

  const rawNotes: MelodyNote[] = data.notes.map((n) => ({
    pitch: n.pitch,
    start: n.start,
    duration: n.duration,
    velocity: (n.velocity ?? 80) / 127,
    confidence: n.confidence ?? 0.8,
  }));

  return {
    provider: "remote-python",
    rawNotes,
    cleanMelody: polishMelody(rawNotes),
    warnings: [],
  };
}
