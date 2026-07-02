import { after } from "next/server";

export function scheduleAfterResponse(task: () => Promise<void> | void): void {
  try {
    after(task);
  } catch {
    void Promise.resolve().then(task).catch(() => {});
  }
}
