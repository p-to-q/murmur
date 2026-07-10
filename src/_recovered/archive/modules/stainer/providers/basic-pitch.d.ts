// Type shim for @spotify/basic-pitch
// The package doesn't ship TypeScript declarations; these are minimal stubs.
declare module "@spotify/basic-pitch" {
  export class BasicPitch {
    constructor(modelPath: string);
    evaluateModel(
      audioBuffer: AudioBuffer,
      onFrames: (frames: number[][], onsets: number[][], contours: number[][]) => void,
      onComplete: () => void
    ): Promise<void>;
  }

  export function addPitchBendsToNoteEvents(
    contours: number[][],
    noteEvents: number[][]
  ): number[][];

  export function outputToNotesPoly(
    frames: number[][],
    onsets: number[][],
    onsetThreshold: number,
    frameThreshold: number,
    minNoteLength: number
  ): number[][];
}
