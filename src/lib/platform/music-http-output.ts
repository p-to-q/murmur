export interface HttpConditioningExpectation {
  humPresent: boolean;
  styleMix: number;
  melody: string;
}

/** Verify that the HTTP Worker applied every requested conditioning signal. */
export function verifyHttpConditioningHeaders(
  headers: Headers,
  expected: HttpConditioningExpectation,
  requireDetailedEvidence: boolean,
): string | null {
  if (expected.humPresent && expected.styleMix > 0) {
    const styleMix = Number(headers.get("x-style-mix"));
    if (!Number.isFinite(styleMix) || Math.abs(styleMix - expected.styleMix) > 0.0051) {
      return "worker_hum_conditioning_not_applied";
    }
  }
  if (expected.melody.trim()) {
    if (headers.get("x-melody-conditioned") !== "1") {
      return "worker_melody_conditioning_not_applied";
    }
    if (requireDetailedEvidence) {
      const segments = Number(headers.get("x-melody-segments"));
      const coverage = Number(headers.get("x-melody-coverage"));
      if (!Number.isInteger(segments) || segments < 1 || !Number.isFinite(coverage) || coverage <= 0) {
        return "worker_melody_conditioning_evidence_invalid";
      }
    }
  }
  return null;
}
