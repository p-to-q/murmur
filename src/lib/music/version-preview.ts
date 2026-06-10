import { synth } from "@/lib/music/simple-synth";
import type { VibeVersion } from "@/modules/shared/types";

/**
 * Unified preview playback for VibeVersions.
 *
 * Magenta versions play their generated clip through an HTMLAudioElement
 * (looped); legacy versions keep the Tone.js synth. A Magenta version whose
 * clip hasn't landed yet plays nothing — we never mix the two sounds for one
 * card — and `play` returns false so callers can keep their UI honest.
 */
class VersionPreview {
  private audio: HTMLAudioElement | null = null;

  /** Start preview. Returns false when there is nothing to play yet. */
  play(version: VibeVersion): boolean {
    this.stop();
    if (version.generation) {
      const url = version.generation.audioUrl;
      if (!url) return false;
      const el = new Audio(url);
      el.loop = true;
      void el.play().catch(() => {});
      this.audio = el;
      return true;
    }
    synth.play(version);
    return true;
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    synth.stop();
  }
}

export const versionPreview = new VersionPreview();
