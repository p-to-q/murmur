export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
  if (!url || typeof document === "undefined") {
    throw new Error("download unavailable");
  }

  if (url.startsWith("data:") || url.startsWith("blob:")) {
    triggerDownload(url, filename);
    return;
  }

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    triggerDownload(url, filename);
    return;
  }
  if (!response.ok || response.type === "opaque") {
    triggerDownload(url, filename);
    return;
  }
  const blob = await response.blob();
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof URL === "undefined") {
    throw new Error("download unavailable");
  }
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  requestAnimationFrame(() => {
    anchor.remove();
  });
}
