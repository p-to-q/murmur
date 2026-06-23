import type { StrummerEditRequestErrorCode } from "@/lib/api/strummer";

export type StudioPromptRecovery = {
  messageKey: string;
  navigateTo?: "/topup";
  refreshBalance?: boolean;
};

export function studioPromptRecoveryForCode(
  code: StrummerEditRequestErrorCode,
): StudioPromptRecovery {
  switch (code) {
    case "insufficient_notes":
      return {
        messageKey: "studio.prompt.insufficient_notes",
        navigateTo: "/topup",
        refreshBalance: true,
      };
    case "billing_unavailable":
      return {
        messageKey: "studio.prompt.billing_unavailable",
        refreshBalance: true,
      };
    case "rate_limited":
      return { messageKey: "studio.prompt.rate_limited" };
    case "unauthorized":
      return { messageKey: "studio.prompt.unauthorized" };
    case "validation_error":
      return { messageKey: "studio.prompt.validation_error" };
    case "llm_unavailable":
    case "network_error":
    case "server_error":
      return { messageKey: "studio.prompt.llm_unavailable" };
  }
}
