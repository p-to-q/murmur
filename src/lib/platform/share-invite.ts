import { toast } from "sonner";

interface ShareInviteCopyMessages {
  copied: string;
  copyFailed: string;
}

export async function copyShareInviteLink(
  url: string,
  messages: ShareInviteCopyMessages,
): Promise<boolean> {
  if (!url || typeof window === "undefined") {
    toast.error(messages.copyFailed);
    return false;
  }

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    } else if (!copyTextWithSelection(url)) {
      throw new Error("clipboard unavailable");
    }
    toast.success(messages.copied);
    return true;
  } catch {
    if (copyTextWithSelection(url)) {
      toast.success(messages.copied);
      return true;
    } else {
      toast.error(messages.copyFailed);
      return false;
    }
  }
}

function copyTextWithSelection(text: string): boolean {
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
  } finally {
    document.body.removeChild(textarea);
  }
}
