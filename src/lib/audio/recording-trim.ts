export interface RecordingTrimResult {
  blob: Blob;
  trimmed: boolean;
  originalDurationMs: number | null;
  trimmedDurationMs: number | null;
}

export interface SampleRange {
  start: number;
  end: number;
}

interface TrimOptions {
  thresholdRms: number;
  windowMs: number;
  paddingMs: number;
  minDurationMs: number;
}

const DEFAULT_TRIM_OPTIONS: TrimOptions = {
  thresholdRms: 0.012,
  windowMs: 20,
  paddingMs: 250,
  minDurationMs: 300,
};

/**
 * Decode a captured recording, trim sustained silence from head/tail, and
 * return a mono WAV blob for upload. If the browser cannot decode the format
 * or the trim would destroy the take, callers should keep the original blob.
 */
export async function trimRecordingForUpload(
  blob: Blob,
): Promise<RecordingTrimResult> {
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const mono = mixToMono(buffer);
    const options = DEFAULT_TRIM_OPTIONS;
    const range = findVoicedSampleRange(mono, buffer.sampleRate, options);
    const originalDurationMs = Math.round((mono.length / buffer.sampleRate) * 1000);

    if (!range) {
      return {
        blob,
        trimmed: false,
        originalDurationMs,
        trimmedDurationMs: originalDurationMs,
      };
    }

    const trimmedSamples = mono.slice(range.start, range.end);
    const trimmedDurationMs = Math.round(
      (trimmedSamples.length / buffer.sampleRate) * 1000,
    );
    const removedMs = originalDurationMs - trimmedDurationMs;

    if (trimmedDurationMs < options.minDurationMs || removedMs < 120) {
      return {
        blob,
        trimmed: false,
        originalDurationMs,
        trimmedDurationMs: originalDurationMs,
      };
    }

    return {
      blob: encodePcm16Wav(trimmedSamples, buffer.sampleRate),
      trimmed: true,
      originalDurationMs,
      trimmedDurationMs,
    };
  } finally {
    await audioContext.close().catch(() => {});
  }
}

export function findVoicedSampleRange(
  samples: Float32Array,
  sampleRate: number,
  options: TrimOptions = DEFAULT_TRIM_OPTIONS,
): SampleRange | null {
  if (samples.length === 0) return null;

  const windowSize = Math.max(1, Math.round((options.windowMs / 1000) * sampleRate));
  const padding = Math.round((options.paddingMs / 1000) * sampleRate);

  let firstWindow = -1;
  let lastWindow = -1;

  for (let start = 0, windowIndex = 0; start < samples.length; start += windowSize, windowIndex++) {
    const end = Math.min(samples.length, start + windowSize);
    const rms = windowRms(samples, start, end);
    if (rms >= options.thresholdRms) {
      if (firstWindow === -1) firstWindow = windowIndex;
      lastWindow = windowIndex;
    }
  }

  if (firstWindow === -1 || lastWindow === -1) return null;

  const start = Math.max(0, firstWindow * windowSize - padding);
  const end = Math.min(samples.length, (lastWindow + 1) * windowSize + padding);
  if (end <= start) return null;
  return { start, end };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      mono[index] += (data[index] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mono;
}

function windowRms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index++) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
