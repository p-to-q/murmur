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
    let revoked: string | null = null;
    globalThis.URL = {
      ...originalUrl,
      createObjectURL: () => "blob:test-download",
      revokeObjectURL: (url: string) => {
        revoked = url;
      },
    } as typeof URL;

    downloadBlob(new Blob(["hello"], { type: "text/plain" }), "hello.txt");

    expect(clicks).toEqual([
      { href: "blob:test-download", download: "hello.txt", attached: true },
    ]);
    expect(revoked).toBe("blob:test-download");
  });

  it("fetches remote URLs as blobs before downloading", async () => {
    const { clicks } = installDomHarness();
    globalThis.URL = {
      ...originalUrl,
      createObjectURL: () => "blob:remote-download",
      revokeObjectURL: () => {},
    } as typeof URL;
    globalThis.fetch = (async () =>
      new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 })) as typeof fetch;

    await downloadUrlAsFile("https://cdn.example/song.mp3", "song.mp3");

    expect(clicks).toEqual([
      { href: "blob:remote-download", download: "song.mp3", attached: true },
    ]);
  });
});
