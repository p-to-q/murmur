export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
  if (!url || typeof document === "undefined") {
    throw new Error("download unavailable");
  }

  if (url.startsWith("data:") || url.startsWith("blob:")) {
    triggerDownload(url, filename);
    return;
  }

  // Controlled song-audio routes already authorize the request and provide a
  // Content-Disposition filename. Let the browser stream them directly rather
  // than buffering the whole master into a second Blob in page memory.
  if (url.startsWith("/") && new URL(url, window.location.href).searchParams.get("download") === "1") {
    triggerDownload(url);
    return;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new Error("remote download failed", { cause });
  }
  if (!response.ok || response.type === "opaque") {
    throw new Error(`remote download returned ${response.status || "an opaque response"}`);
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

function triggerDownload(url: string, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? "";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  requestAnimationFrame(() => {
    anchor.remove();
  });
}
