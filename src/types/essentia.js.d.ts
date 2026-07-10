declare module "essentia.js" {
  export const EssentiaWASM: unknown;
  export class Essentia {
    constructor(wasmModule: unknown);
    PitchYinProbabilistic(
      signal: Float32Array,
      frameSize: number,
      hopSize: number,
      lowRMSThreshold: number,
      outputUnvoiced: string,
      preciseTime: boolean,
      sampleRate: number,
    ): {
      pitch: Float32Array;
      voicedProbabilities: Float32Array;
    };
  }
}
