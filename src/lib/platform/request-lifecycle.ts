import { after } from "next/server";

export function scheduleAfterResponse(task: () => Promise<void> | void): void {
  try {
    after(task);
  } catch (error) {
    if (!isMissingRequestScopeError(error)) {
      throw error;
    }
    void Promise.resolve().then(task).catch(() => {});
  }
}

function isMissingRequestScopeError(error: unknown): boolean {
  return (
    error instanceof Error
    && error.message.includes("outside a request scope")
  );
}
