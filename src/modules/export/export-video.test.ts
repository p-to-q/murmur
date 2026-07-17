import { afterEach, describe, expect, it } from "bun:test";
import { VideoExportError, waitForMedia, waitForPlaybackEnd } from "./export-video";

const originalWindow = globalThis.window;

type Listener = () => void;

class TestAudio {
  readyState = 0;
  duration = 1;
  private listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as Listener);
  }

  removeEventListener(type: string) {
    this.listeners.delete(type);
  }

  dispatch(type: string) {
    this.listeners.get(type)?.();
  }
}

function installTimerHarness() {
  const timers: Array<() => void> = [];
  globalThis.window = {
    setTimeout(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  } as unknown as Window & typeof globalThis;
  return { timers };
}

afterEach(() => {
  globalThis.window = originalWindow;
});

describe("video export media waits", () => {
  it("rejects when audio metadata never loads", async () => {
    const { timers } = installTimerHarness();
    const audio = new TestAudio();
    const pending = waitForMedia(audio as unknown as HTMLAudioElement, 50);

    timers[0]?.();

    await expect(pending).rejects.toMatchObject({
      name: "VideoExportError",
      code: "audio_load_failed",
    } satisfies Partial<VideoExportError>);
  });

  it("rejects instead of resolving when playback errors", async () => {
    installTimerHarness();
    const audio = new TestAudio();
    const pending = waitForPlaybackEnd(audio as unknown as HTMLAudioElement);

    audio.dispatch("error");

    await expect(pending).rejects.toMatchObject({
      name: "VideoExportError",
      code: "audio_load_failed",
    } satisfies Partial<VideoExportError>);
  });
});
