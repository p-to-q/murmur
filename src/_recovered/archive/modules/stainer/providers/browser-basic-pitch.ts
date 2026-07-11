import type { MelodyNote, TranscriptionInput, TranscriptionResult } from "@/modules/shared/types";
import { polishMelody } from "@/modules/music/melody-polisher";

/** Browser-side Basic Pitch provider using @spotify/basic-pitch */
export async function transcribeBrowserBasicPitch(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  if (process.env.NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER !== "true") {
    throw new Error("Browser Basic Pitch disabled — set NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER=true to enable.");
  }
  if (!input.audioBlob) {
    throw new Error("Browser Basic Pitch requires an audio blob");
  }

  // Dynamic import — protected from bundler static analysis
  // Use Function() so Next.js build doesn't try to resolve it
  const pkg = (await new Function(
    'return import("@spotify/basic-pitch")'
  )()) as {
    BasicPitch: new (modelUrl: string) => {
      evaluateModel: (
        audio: AudioBuffer,
        cb: (frames: number[][], onsets: number[][], contours: number[][]) => void,
        done: () => void
      ) => Promise<void>;
    };
    addPitchBendsToNoteEvents: (contours: number[][], events: number[][]) => number[][];
    outputToNotesPoly: (
      frames: number[][],
      onsets: number[][],
      onsetThresh: number,
      frameThresh: number,
      minNoteLen: number
    ) => number[][];
  };
  const { BasicPitch, addPitchBendsToNoteEvents, outputToNotesPoly } = pkg;

  const arrayBuffer = await input.audioBlob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 22050 });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await new Promise<void>((resolve, reject) => {
    const bp = new BasicPitch(
      // Use CDN model path — works in both browser and Node with fetch
      "https://unpkg.com/@spotify/basic-pitch@0.0.2/model/model.json"
    );
    bp.evaluateModel(
      audioBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      resolve
    ).catch(reject);
  });

  const rawEvents = outputToNotesPoly(frames, onsets, 0.5, 0.3, 5);
  const withBends = addPitchBendsToNoteEvents(contours, rawEvents);

  const rawNotes: MelodyNote[] = withBends.map((row) => {
    const [pitch, start, duration, amplitude] = row;
    return {
      pitch: pitch ?? 60,
      start: start ?? 0,
      duration: duration ?? 0.5,
      velocity: amplitude ?? 0.7,
      confidence: 0.85,
    };
  });

  return {
    provider: "browser-basic-pitch",
    rawNotes,
    cleanMelody: polishMelody(rawNotes),
    warnings: [],
  };
}
