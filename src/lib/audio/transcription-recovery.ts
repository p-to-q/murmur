export const TRANSCRIPTION_RESUME_PARAM = "resume";
export const TRANSCRIPTION_RESUME_VALUE = "transcription";

export function isTranscriptionResumeRequested(value: unknown): boolean {
  return value === TRANSCRIPTION_RESUME_VALUE;
}

/** Add the bounded transcription continuation marker to an internal href. */
export function withTranscriptionResume(href: string): string {
  const url = new URL(href, "https://murmur.local");
  url.searchParams.set(TRANSCRIPTION_RESUME_PARAM, TRANSCRIPTION_RESUME_VALUE);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function transcriptionResumePath(): string {
  return withTranscriptionResume("/");
}

export function checkoutSuccessDestination(resume: unknown): string {
  return isTranscriptionResumeRequested(resume)
    ? transcriptionResumePath()
    : "/me";
}
