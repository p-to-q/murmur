import { afterEach, describe, expect, it } from "bun:test";
import { downloadBlob, downloadUrlAsFile } from "./download";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalUrl = globalThis.URL;
const originalFetch = globalThis.fetch;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

function installDomHarness() {
  const clicks: Array<{ href: string; download: string; attached: boolean }> = [];
  const body = {
    appendChild(anchor: TestAnchor) {
      anchor.attached = true;
    },
  };

  class TestAnchor {
    href = "";
    download = "";
    rel = "";
    style = { display: "" };
    attached = false;
    click() {
      clicks.push({
        href: this.href,
        download: this.download,
        attached: this.attached,
      });
    }
    remove() {
      this.attached = false;
    }
  }

  globalThis.document = {
    body,
    createElement(tag: string) {
      if (tag !== "a") throw new Error(`unexpected tag ${tag}`);
      return new TestAnchor();
    },
  } as unknown as Document;
  globalThis.window = {
    location: new URL("https://murmur.example/gallery"),
    setTimeout(fn: () => void) {
      fn();
      return 0;
    },
  } as unknown as Window & typeof globalThis;
  globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    fn(0);
    return 0;
  }) as typeof requestAnimationFrame;

  return { clicks };
}

function installObjectUrlHarness(objectUrl: string) {
  let revoked: string | null = null;
  globalThis.URL = class TestUrl extends originalUrl {
    static createObjectURL() {
      return objectUrl;
    }
    static revokeObjectURL(url: string) {
      revoked = url;
    }
  } as typeof URL;
  return { revoked: () => revoked };
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.URL = originalUrl;
  globalThis.fetch = originalFetch;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

describe("download helpers", () => {
  it("attaches the anchor before clicking blob downloads", () => {
    const { clicks } = installDomHarness();
    const objectUrls = installObjectUrlHarness("blob:test-download");

    downloadBlob(new Blob(["hello"], { type: "text/plain" }), "hello.txt");

    expect(clicks).toEqual([
      { href: "blob:test-download", download: "hello.txt", attached: true },
    ]);
    expect(objectUrls.revoked()).toBe("blob:test-download");
  });

  it("fetches same-origin API audio with credentials before reporting success", async () => {
    const { clicks } = installDomHarness();
    installObjectUrlHarness("blob:api-download");
    let resolveResponse: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestInit = init;
      return responsePromise;
    }) as typeof fetch;

    const download = downloadUrlAsFile("/api/songs/song-1/audio?download=1", "song.mp3");
    await Promise.resolve();
    expect(clicks).toEqual([]);

    resolveResponse?.(
      new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 }),
    );
    expect(await download).toBe("song.mp3");

    expect(clicks).toEqual([
      { href: "blob:api-download", download: "song.mp3", attached: true },
    ]);
    expect(requestInit?.credentials).toBe("include");
    expect(requestInit?.cache).toBe("no-store");
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses a same-origin API filename and WAV extension from response metadata", async () => {
    const { clicks } = installDomHarness();
    installObjectUrlHarness("blob:wav-download");
    globalThis.fetch = (async () => new Response(new Blob(["audio"], {
      type: "audio/wav",
    }), {
      status: 200,
      headers: {
        "Content-Disposition": "attachment; filename=\"fallback.wav\"; filename*=UTF-8''%E5%93%BC%E5%94%B1.wav",
        "Content-Type": "audio/wav",
      },
    })) as typeof fetch;

    const filename = await downloadUrlAsFile(
      "/api/songs/song-1/audio?download=1",
      "wrong.mp3",
    );

    expect(filename).toBe("哼唱.wav");
    expect(clicks).toEqual([
      { href: "blob:wav-download", download: "哼唱.wav", attached: true },
    ]);
  });

  it("does not trust cross-origin Content-Disposition filenames", async () => {
    const { clicks } = installDomHarness();
    installObjectUrlHarness("blob:remote-download");
    globalThis.fetch = (async () => new Response(new Blob(["audio"], {
      type: "audio/wav",
    }), {
      status: 200,
      headers: {
        "Content-Disposition": "attachment; filename=\"../unsafe.exe\"",
        "Content-Type": "audio/wav",
      },
    })) as typeof fetch;

    const filename = await downloadUrlAsFile(
      "https://cdn.example/audio",
      "safe.mp3",
    );

    expect(filename).toBe("safe.wav");
    expect(clicks[0]?.download).toBe("safe.wav");
  });

  it("keeps data and blob URLs as direct downloads", async () => {
    const { clicks } = installDomHarness();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    await downloadUrlAsFile("data:audio/mpeg;base64,YXVkaW8=", "data.mp3");
    await downloadUrlAsFile("blob:existing-audio", "blob.mp3");

    expect(fetchCalls).toBe(0);
    expect(clicks).toEqual([
      {
        href: "data:audio/mpeg;base64,YXVkaW8=",
        download: "data.mp3",
        attached: true,
      },
      { href: "blob:existing-audio", download: "blob.mp3", attached: true },
    ]);
  });

  for (const status of [401, 410, 429, 503]) {
    it(`rejects API status ${status} without triggering a download`, async () => {
      const { clicks } = installDomHarness();
      globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;

      await expect(
        downloadUrlAsFile("/api/songs/song-1/audio?download=1", "song.mp3"),
      ).rejects.toThrow(`remote download returned ${status}`);

      expect(clicks).toEqual([]);
    });
  }

  it("does not report success when a remote download cannot be verified", async () => {
    const { clicks } = installDomHarness();
    globalThis.fetch = (async () => {
      throw new Error("cors blocked");
    }) as typeof fetch;

    await expect(
      downloadUrlAsFile("https://cdn.example/song.mp3", "song.mp3"),
    ).rejects.toThrow("remote download failed");

    expect(clicks).toEqual([]);
  });

  it("rejects non-audio responses before buffering them", async () => {
    const { clicks } = installDomHarness();
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "signed out" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await expect(
      downloadUrlAsFile("/api/songs/song-1/audio?download=1", "song.mp3"),
    ).rejects.toThrow("unsupported content type application/json");

    expect(clicks).toEqual([]);
  });

  it("rejects oversized responses before buffering them", async () => {
    const { clicks } = installDomHarness();
    let blobRead = false;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      type: "basic",
      headers: new Headers({
        "Content-Length": String(64 * 1024 * 1024 + 1),
        "Content-Type": "audio/mpeg",
      }),
      blob: async () => {
        blobRead = true;
        return new Blob(["audio"], { type: "audio/mpeg" });
      },
    }) as Response) as typeof fetch;

    await expect(
      downloadUrlAsFile("/api/songs/song-1/audio?download=1", "song.mp3"),
    ).rejects.toThrow("remote download is too large");

    expect(blobRead).toBe(false);
    expect(clicks).toEqual([]);
  });

  it("cancels a chunked response when it crosses the memory limit", async () => {
    const { clicks } = installDomHarness();
    let canceled = false;
    const oversizedChunk = new Uint8Array(64 * 1024 * 1024 + 1);
    globalThis.fetch = (async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(oversizedChunk);
      },
      cancel() {
        canceled = true;
      },
    }), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    })) as typeof fetch;

    await expect(
      downloadUrlAsFile("/api/songs/song-1/audio?download=1", "song.mp3"),
    ).rejects.toThrow("remote download is too large");

    expect(canceled).toBe(true);
    expect(clicks).toEqual([]);
  });
});
