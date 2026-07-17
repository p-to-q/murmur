const CLIPBOARD_WRITE_TIMEOUT_MS = 2000;

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text || typeof window === "undefined") return false;

  try {
    if (navigator.clipboard) {
      await withTimeout(
        navigator.clipboard.writeText(text),
        CLIPBOARD_WRITE_TIMEOUT_MS,
      );
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }

  return copyTextWithSelection(text);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("clipboard write timed out")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * Legacy `execCommand("copy")` fallback for environments without the async
 * Clipboard API. Exported so `share-invite.ts` reuses the same implementation.
 */
export function copyTextWithSelection(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
