export type SupportedAudioFileType = "mp3" | "wav";

/** Detect the file container from bytes instead of trusting a MIME label. */
export function detectAudioFileType(bytes: Uint8Array): SupportedAudioFileType | null {
  if (isWave(bytes)) return "wav";
  if (isMp3(bytes)) return "mp3";
  return null;
}

function isWave(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && ascii(bytes, 0, 4) === "RIFF"
    && ascii(bytes, 8, 12) === "WAVE";
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= 3 && ascii(bytes, 0, 3) === "ID3") return true;

  // Encoders are allowed to omit ID3. Scan the beginning for a plausible
  // MPEG audio frame header while rejecting reserved layer/rate fields.
  const limit = Math.min(bytes.byteLength - 3, 4_096);
  for (let index = 0; index <= limit; index += 1) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    if (
      first === 0xff
      && (second & 0xe0) === 0xe0
      && (second & 0x06) !== 0
      && ((third >> 4) & 0x0f) !== 0
      && ((third >> 4) & 0x0f) !== 0x0f
      && ((third >> 2) & 0x03) !== 0x03
    ) {
      return true;
    }
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
