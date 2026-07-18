export const MUSIC_QUALITY_GATE_VERSION = "music-technical-v1";

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
  if (sampleRate < 16_000 || sampleRate > 96_000 || dataOffset < 0 || dataSize < 2) {
    failures.push("invalid_audio_data");
    return result(failures, { channels, sampleRate });
  }

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
  if (Math.abs(durationSeconds - expectedDuration) > Math.max(0.35, expectedDuration * 0.08)) {
    failures.push("duration_mismatch");
  }
  if (rms < 0.003) failures.push("near_silence");
  if (activeRatio < 0.12) failures.push("mostly_silent");
  if (clippingRatio > 0.02) failures.push("severe_clipping");
  if (dcOffset > 0.08) failures.push("dc_offset");
  return result(failures, {
    channels,
    sampleRate,
    frameCount,
    durationSeconds: round(durationSeconds),
    rms: round(rms),
    peak: round(peak / 32768),
    clippingRatio: round(clippingRatio),
    activeRatio: round(activeRatio),
    dcOffset: round(dcOffset),
  });
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function result(
  failures: string[],
  metrics: Record<string, number>,
): MusicQualityGateResult {
  return { version: MUSIC_QUALITY_GATE_VERSION, passed: failures.length === 0, failures, metrics };
}
