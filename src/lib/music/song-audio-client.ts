export interface ClientSongAudioReference {
  audioUrl?: string | null;
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
}

/** Stable API URL first; legacy fields only support old cached payloads. */
export function resolveClientSongAudioUrl(song: ClientSongAudioReference): string | null {
  return nonEmpty(song.audioUrl) ?? nonEmpty(song.mp3DataUrl) ?? nonEmpty(song.mp3Url);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
