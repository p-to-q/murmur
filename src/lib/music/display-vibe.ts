/**
 * Human-readable vibe label for a saved song.
 *
 * Magenta songs store a generated id in `vibe` (e.g. "mgt-14uu8cf") — for
 * display, fall back to the song's first tag, which is the genre half of
 * the prompt ("swing jazz", "city pop", …). Legacy songs store a readable
 * preset id ("sunset") and pass through unchanged.
 */
export function displayVibeLabel(vibe: string, tags?: string[] | null): string {
  if (vibe.startsWith("mgt-")) return tags?.[0] ?? "magenta";
  return vibe;
}
