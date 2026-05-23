import type { SongCard } from "@/modules/shared/types";

/** Export a SongCard as WebM video by recording the canvas visual */
export async function exportSongAsWebM(song: SongCard): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#song-visual canvas");
  if (!canvas) {
    // Graceful degradation — alert if no canvas found
    alert("无法找到视觉画布，请先打开作品详情页后再导出。");
    return;
  }

  const supported =
    MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ||
    MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ||
    MediaRecorder.isTypeSupported("video/webm");

  if (!supported) {
    alert("当前浏览器不支持 WebM 导出，请尝试使用 Chrome 或 Edge。");
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
    ? "video/webm;codecs=vp8"
    : "video/webm";

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.title.replace(/\s+/g, "-").toLowerCase()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recordDuration = Math.min(10_000, Math.max(3_000, song.duration * 1000));
  recorder.start();
  setTimeout(() => recorder.stop(), recordDuration);
}
