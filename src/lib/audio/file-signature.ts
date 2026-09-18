export type SupportedAudioFileType = "mp3" | "wav";

// The Web generation path is capped at 20 seconds. This admits its largest
// PCM WAV (plus container overhead) while bounding save decoding and delivery.
export const MAX_SONG_AUDIO_BYTES = 8 * 1024 * 1024;

/** Detect the file container from bytes instead of trusting a MIME label. */
export function detectAudioFileType(bytes: Uint8Array): SupportedAudioFileType | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SONG_AUDIO_BYTES) return null;
  if (isWave(bytes)) return "wav";
  if (isMp3(bytes)) return "mp3";
  return null;
}

/** Detect a supported container from a leading byte range, not a whole file. */
export function detectAudioFilePrefix(bytes: Uint8Array): SupportedAudioFileType | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SONG_AUDIO_BYTES) return null;
  if (isWavePrefix(bytes)) return "wav";
  if (isMp3(bytes)) return "mp3";
  return null;
}

function isWavePrefix(bytes: Uint8Array): boolean {
  if (
    bytes.byteLength < 12
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 12) !== "WAVE"
  ) {
    return false;
  }

  const declaredFileSize = readUint32Le(bytes, 4) + 8;
  return declaredFileSize >= bytes.byteLength
    && declaredFileSize <= MAX_SONG_AUDIO_BYTES;
}

function isWave(bytes: Uint8Array): boolean {
  if (
    bytes.byteLength < 12
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 12) !== "WAVE"
  ) {
    return false;
  }

  const riffEnd = readUint32Le(bytes, 4) + 8;
  if (riffEnd < 12 || riffEnd !== bytes.byteLength) return false;

  let hasFormat = false;
  let hasAudioData = false;
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const chunkId = ascii(bytes, offset, offset + 4);
    const chunkSize = readUint32Le(bytes, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > riffEnd) return false;

    if (chunkId === "fmt ") {
      if (chunkSize < 16) return false;
      const format = readUint16Le(bytes, chunkStart);
      const channels = readUint16Le(bytes, chunkStart + 2);
      const sampleRate = readUint32Le(bytes, chunkStart + 4);
      const blockAlign = readUint16Le(bytes, chunkStart + 12);
      if (format === 0 || channels === 0 || sampleRate === 0 || blockAlign === 0) {
        return false;
      }
      hasFormat = true;
    } else if (chunkId === "data" && chunkSize > 0) {
      hasAudioData = true;
    }

    const paddedEnd = chunkEnd + (chunkSize % 2);
    if (paddedEnd > riffEnd) return false;
    offset = paddedEnd;
  }

  return offset === riffEnd && hasFormat && hasAudioData;
}

function isMp3(bytes: Uint8Array): boolean {
  const audioStart = id3AudioStart(bytes);
  if (audioStart === null) return false;

  // Encoders may omit ID3 or leave a small padding gap after it. Require a
  // complete MPEG frame instead of accepting a coincidental sync prefix.
  const limit = Math.min(bytes.byteLength - 4, audioStart + 4_096);
  for (let offset = audioStart; offset <= limit; offset += 1) {
    const frameLength = mp3FrameLength(bytes, offset);
    if (frameLength === null || offset + frameLength > bytes.byteLength) continue;

    const nextOffset = offset + frameLength;
    if (nextOffset === bytes.byteLength) return true;
    const nextLength = mp3FrameLength(bytes, nextOffset);
    if (nextLength !== null && nextOffset + nextLength <= bytes.byteLength) return true;
  }
  return false;
}

function id3AudioStart(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 3 || ascii(bytes, 0, 3) !== "ID3") return 0;
  if (bytes.byteLength < 10) return null;

  const version = bytes[3] ?? 0;
  const revision = bytes[4] ?? 0;
  const flags = bytes[5] ?? 0;
  const sizeBytes = bytes.slice(6, 10);
  if (
    version < 2
    || version > 4
    || revision === 0xff
    || sizeBytes.some((value) => (value & 0x80) !== 0)
  ) {
    return null;
  }

  const tagSize = sizeBytes.reduce((size, value) => (size << 7) | value, 0);
  const footerSize = version === 4 && (flags & 0x10) !== 0 ? 10 : 0;
  const audioStart = 10 + tagSize + footerSize;
  return audioStart <= bytes.byteLength ? audioStart : null;
}

function mp3FrameLength(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  const first = bytes[offset] ?? 0;
  const second = bytes[offset + 1] ?? 0;
  const third = bytes[offset + 2] ?? 0;
  if (first !== 0xff || (second & 0xe0) !== 0xe0) return null;

  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  const padding = (third >> 1) & 0x01;
  if (
    versionBits === 0x01
    || layerBits === 0
    || bitrateIndex === 0
    || bitrateIndex === 0x0f
    || sampleRateIndex === 0x03
  ) {
    return null;
  }

  const bitrateKbps = mp3BitrateKbps(versionBits, layerBits, bitrateIndex);
  const sampleRate = mp3SampleRate(versionBits, sampleRateIndex);
  if (!bitrateKbps || !sampleRate) return null;

  if (layerBits === 0x03) {
    return Math.floor((12 * bitrateKbps * 1_000) / sampleRate + padding) * 4;
  }
  const coefficient = layerBits === 0x01 && versionBits !== 0x03 ? 72 : 144;
  return Math.floor((coefficient * bitrateKbps * 1_000) / sampleRate) + padding;
}

function mp3BitrateKbps(
  versionBits: number,
  layerBits: number,
  index: number,
): number | null {
  const mpeg1 = versionBits === 0x03;
  const table = mpeg1
    ? layerBits === 0x03
      ? [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
      : layerBits === 0x02
        ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
        : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : layerBits === 0x03
      ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return table[index] ?? null;
}

function mp3SampleRate(versionBits: number, index: number): number | null {
  const rates = versionBits === 0x03
    ? [44_100, 48_000, 32_000]
    : versionBits === 0x02
      ? [22_050, 24_000, 16_000]
      : [11_025, 12_000, 8_000];
  return rates[index] ?? null;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0)
    + (bytes[offset + 1] ?? 0) * 0x100
    + (bytes[offset + 2] ?? 0) * 0x1_0000
    + (bytes[offset + 3] ?? 0) * 0x1_0000_00
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
