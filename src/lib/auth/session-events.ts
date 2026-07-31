export const MURMUR_SESSION_READY_EVENT = "murmur:session-ready";

let observedSessionReady = false;

export function notifyMurmurSessionReady(): void {
  observedSessionReady = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MURMUR_SESSION_READY_EVENT));
  }
}

export function hasObservedMurmurSessionReady(): boolean {
  return observedSessionReady;
}
