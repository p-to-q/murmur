export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text || typeof window === "undefined") return false;

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }

  return copyTextWithSelection(text);
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
