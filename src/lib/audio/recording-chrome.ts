export function shouldShowRecordingChrome({
  isRecording,
  isStartingCapture,
}: {
  isRecording: boolean;
  isStartingCapture: boolean;
}) {
  return isStartingCapture || isRecording;
}

export function visibleRecordingProgress(progress: number, isVisible: boolean) {
  if (!isVisible) return 0;
  return Math.max(0.004, Math.min(1, progress));
}
