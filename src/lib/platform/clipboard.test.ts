import { afterEach, describe, expect, it } from "bun:test";
import { copyTextToClipboard } from "./clipboard";

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

function installSelectionFallback() {
  let copied = false;
  let textareaValue = "";
  globalThis.document = {
    body: {
      appendChild(textarea: { value: string }) {
        textareaValue = textarea.value;
      },
      removeChild() {},
    },
    createElement(tag: string) {
      if (tag !== "textarea") throw new Error(`unexpected tag ${tag}`);
      return {
        value: "",
        style: {},
        setAttribute() {},
        select() {},
      };
    },
    execCommand(command: string) {
      copied = command === "copy";
      return copied;
    },
  } as unknown as Document;
  return { copied: () => copied, textareaValue: () => textareaValue };
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.navigator = originalNavigator;
  globalThis.document = originalDocument;
});

describe("copyTextToClipboard", () => {
  it("falls back when async clipboard never resolves", async () => {
    const fallback = installSelectionFallback();
    globalThis.window = {
      setTimeout(fn: () => void) {
        fn();
        return 0;
      },
      clearTimeout() {},
    } as unknown as Window & typeof globalThis;
    globalThis.navigator = {
      clipboard: {
        writeText: () => new Promise<void>(() => {}),
      },
    } as unknown as Navigator;

    await expect(copyTextToClipboard("https://murmur.test/s/abc")).resolves.toBe(true);
    expect(fallback.copied()).toBe(true);
    expect(fallback.textareaValue()).toBe("https://murmur.test/s/abc");
  });
});
