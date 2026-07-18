import { afterEach, describe, expect, it } from "bun:test";
import { versionPreview } from "./version-preview";
import type { VibeVersion } from "@/modules/shared/types";

const originalAudio = globalThis.Audio;

class RejectingAudio {
  loop = false;
  removed = false;
  constructor(public src: string) {}
  play() {
    return Promise.reject(new Error("blocked"));
  }
  pause() {}
  removeAttribute(name: string) {
    if (name === "src") this.removed = true;
  }
}

class ResolvingAudio {
  loop = false;
  paused = false;
  constructor(public src: string) {}
  play() {
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
}

const generatedVersion = {
  generation: { audioUrl: "blob:test-preview" },
} as VibeVersion;

afterEach(() => {
  versionPreview.stop();
  globalThis.Audio = originalAudio;
});

describe("versionPreview", () => {
  it("rejects when browser playback is blocked", async () => {
    globalThis.Audio = RejectingAudio as unknown as typeof Audio;

    await expect(versionPreview.play(generatedVersion)).rejects.toThrow("blocked");
  });

  it("returns true only after generated audio starts playing", async () => {
    globalThis.Audio = ResolvingAudio as unknown as typeof Audio;

    await expect(versionPreview.play(generatedVersion)).resolves.toBe(true);
  });

  it("returns false when generated audio has not landed yet", async () => {
    await expect(
      versionPreview.play({ generation: {} } as VibeVersion),
    ).resolves.toBe(false);
  });
});
