import { toast } from "sonner";
import { copyTextWithSelection } from "@/lib/platform/clipboard";

interface ShareInviteCopyMessages {
  copied: string;
  copyFailed: string;
}

export async function copyShareInviteLink(
  url: string,
  messages: ShareInviteCopyMessages,
) {
  if (!url || typeof window === "undefined") {
    toast.error(messages.copyFailed);
    return;
  }

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    } else if (!copyTextWithSelection(url)) {
      throw new Error("clipboard unavailable");
    }
    toast.success(messages.copied);
  } catch {
    if (copyTextWithSelection(url)) {
      toast.success(messages.copied);
    } else {
      toast.error(messages.copyFailed);
    }
  }
}
