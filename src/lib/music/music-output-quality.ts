export const MUSIC_QUALITY_GATE_VERSION = "music-technical-v2";

const WINDOW_MILLISECONDS = 100;
const QUIET_WINDOW_DBFS = -42;
const MIN_RMS_DBFS = -34;
const MAX_CREST_FACTOR_DB = 26;
const MAX_QUIET_WINDOW_RATIO = 0.55;
const MAX_QUIET_RUN_RATIO = 0.35;
const MIN_LONG_QUIET_RUN_SECONDS = 1;
const MIN_DROPOUT_SECONDS = 0.4;
const DBFS_FLOOR = -120;

export interface MusicQualityGateResult {
  version: string;
  passed: boolean;
  failures: string[];
  metrics: Record<string, number>;
}

export function analyzePcm16Wav(
  bytes: Uint8Array,
  expectedDuration: number,
): MusicQualityGateResult {
  const failures: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return result(["invalid_wav"], {});
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) break;
    if (id === "fmt " && size >= 16) {
      audioFormat = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      byteRate = view.getUint32(body + 8, true);
      blockAlign = view.getUint16(body + 12, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || ![1, 2].includes(channels)) {
    failures.push("unsupported_pcm_format");
  }
  const declaredRiffBytes = view.getUint32(4, true) + 8;
  const dataEnd = dataOffset >= 0 ? dataOffset + dataSize : 0;
  const expectedBlockAlign = channels * 2;
  if (
    declaredRiffBytes > bytes.byteLength
    || (dataEnd > 0 && declaredRiffBytes < dataEnd)
    || blockAlign !== expectedBlockAlign
    || byteRate !== sampleRate * expectedBlockAlign
    || (blockAlign > 0 && dataSize % blockAlign !== 0)
  ) {
    failures.push("invalid_wav_structure");
  }
  if (sampleRate < 16_000 || sampleRate > 96_000 || dataOffset < 0 || dataSize < 2) {
    failures.push("invalid_audio_data");
    return result(failures, { channels, sampleRate });
  }
  if (failures.length > 0) return result(failures, { channels, sampleRate });

  const sampleCount = Math.floor(dataSize / 2);
  const frameCount = Math.floor(sampleCount / channels);
  const durationSeconds = frameCount / sampleRate;
  let sumSquares = 0;
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  let active = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(dataOffset + index * 2, true);
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sum += sample;
    sumSquares += sample * sample;
    if (absolute >= 32_440) clipped += 1;
    if (absolute >= 164) active += 1;
  }
  const rms = Math.sqrt(sumSquares / sampleCount) / 32768;
  const clippingRatio = clipped / sampleCount;
  const activeRatio = active / sampleCount;
  const dcOffset = Math.abs(sum / sampleCount) / 32768;
  const peakRatio = peak / 32768;
  const rmsDbfs = dbfs(rms);
  const peakDbfs = dbfs(peakRatio);
  const crestFactorDb = peak > 0 ? Math.max(0, peakDbfs - rmsDbfs) : 0;
  const windowMetrics = analyzeWindows({
    view,
    dataOffset,
    sampleCount,
    channels,
    sampleRate,
  });
  if (Math.abs(durationSeconds - expectedDuration) > Math.max(0.35, expectedDuration * 0.08)) {
    failures.push("duration_mismatch");
  }
  if (rms < 0.003) failures.push("near_silence");
  if (activeRatio < 0.12) failures.push("mostly_silent");
  if (clippingRatio > 0.02) failures.push("severe_clipping");
  if (dcOffset > 0.08) failures.push("dc_offset");
  if (rmsDbfs < MIN_RMS_DBFS) failures.push("low_average_level");
  if (crestFactorDb > MAX_CREST_FACTOR_DB) failures.push("excessive_crest_factor");
  if (windowMetrics.quietWindowRatio > MAX_QUIET_WINDOW_RATIO) {
    failures.push("excessive_quiet_windows");
  }
  if (
    windowMetrics.longestQuietRunSeconds
    > Math.max(MIN_LONG_QUIET_RUN_SECONDS, durationSeconds * MAX_QUIET_RUN_RATIO)
  ) {
    failures.push("prolonged_silence");
  }
  // Repeated quiet gaps remain shadow evidence: short rests and staccato can
  // look identical to dropouts without model-aware context.
  return result(failures, {
    channels,
    sampleRate,
    frameCount,
    durationSeconds: round(durationSeconds),
    rms: round(rms),
    peak: round(peakRatio),
    clippingRatio: round(clippingRatio),
    activeRatio: round(activeRatio),
    dcOffset: round(dcOffset),
    rmsDbfs: roundTo(rmsDbfs, 3),
    peakDbfs: roundTo(peakDbfs, 3),
    crestFactorDb: roundTo(crestFactorDb, 3),
    quietWindowRatio: round(windowMetrics.quietWindowRatio),
    longestQuietRunSeconds: roundTo(windowMetrics.longestQuietRunSeconds, 3),
    interiorDropoutCount: windowMetrics.interiorDropoutCount,
  });
}

function analyzeWindows(input: {
  view: DataView;
  dataOffset: number;
  sampleCount: number;
  channels: number;
  sampleRate: number;
}): {
  quietWindowRatio: number;
  longestQuietRunSeconds: number;
  interiorDropoutCount: number;
} {
  const windowFrames = Math.max(1, Math.floor(input.sampleRate * WINDOW_MILLISECONDS / 1_000));
  const windowSamples = windowFrames * input.channels;
  const windows: Array<{ quiet: boolean; frames: number }> = [];
  for (let start = 0; start < input.sampleCount; start += windowSamples) {
    const end = Math.min(input.sampleCount, start + windowSamples);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) {
      const sample = input.view.getInt16(input.dataOffset + index * 2, true);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / (end - start)) / 32768;
    windows.push({
      quiet: dbfs(rms) <= QUIET_WINDOW_DBFS,
      frames: Math.floor((end - start) / input.channels),
    });
  }

  let quietWindows = 0;
  let longestQuietFrames = 0;
  let interiorDropoutCount = 0;
  let runStart = 0;
  while (runStart < windows.length) {
    if (!windows[runStart].quiet) {
      runStart += 1;
      continue;
    }
    quietWindows += 1;
    let runEnd = runStart + 1;
    let runFrames = windows[runStart].frames;
    while (runEnd < windows.length && windows[runEnd].quiet) {
      quietWindows += 1;
      runFrames += windows[runEnd].frames;
      runEnd += 1;
    }
    longestQuietFrames = Math.max(longestQuietFrames, runFrames);
    if (
      runStart > 0
      && runEnd < windows.length
      && runFrames / input.sampleRate >= MIN_DROPOUT_SECONDS
    ) {
      interiorDropoutCount += 1;
    }
    runStart = runEnd;
  }
  return {
    quietWindowRatio: quietWindows / windows.length,
    longestQuietRunSeconds: longestQuietFrames / input.sampleRate,
    interiorDropoutCount,
  };
}

function dbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : DBFS_FLOOR;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function result(
  failures: string[],
  metrics: Record<string, number>,
): MusicQualityGateResult {
  return { version: MUSIC_QUALITY_GATE_VERSION, passed: failures.length === 0, failures, metrics };
}
