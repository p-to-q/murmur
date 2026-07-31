const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_BUFFERED_DOWNLOAD_BYTES = 64 * 1024 * 1024;

export async function downloadUrlAsFile(url: string, filename: string): Promise<string> {
  if (!url || typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("download unavailable");
  }

  if (url.startsWith("data:") || url.startsWith("blob:")) {
    triggerDownload(url, filename);
    return filename;
  }

  const resolvedUrl = resolveDownloadUrl(url);
  const isSameOriginApi = resolvedUrl.origin === window.location.origin
    && resolvedUrl.pathname.startsWith("/api/");

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: isSameOriginApi ? "include" : "omit",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error("remote download failed", { cause });
  }
  if (!response.ok || response.type === "opaque") {
    throw new Error(`remote download returned ${response.status || "an opaque response"}`);
  }

  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!contentType || (!contentType.startsWith("audio/") && contentType !== "application/octet-stream")) {
    throw new Error(`remote download returned unsupported content type ${contentType || "unknown"}`);
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BUFFERED_DOWNLOAD_BYTES) {
    throw new Error("remote download is too large");
  }

  const blob = await readBoundedBlob(response, contentType);
  const resolvedFilename = responseFilename(
    response.headers.get("content-disposition"),
    filename,
    contentType,
    isSameOriginApi,
  );
  downloadBlob(blob, resolvedFilename);
  return resolvedFilename;
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

function resolveDownloadUrl(url: string): URL {
  try {
    return new URL(url, window.location.href);
  } catch (cause) {
    throw new Error("download URL is invalid", { cause });
  }
}

async function readBoundedBlob(response: Response, contentType: string): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("remote download returned an empty response");
  }

  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BUFFERED_DOWNLOAD_BYTES) {
        await reader.cancel("download exceeded memory limit");
        throw new Error("remote download is too large");
      }
      const chunk = new ArrayBuffer(value.byteLength);
      new Uint8Array(chunk).set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) {
    throw new Error("remote download returned an empty response");
  }
  return new Blob(chunks, { type: contentType });
}

function responseFilename(
  contentDisposition: string | null,
  fallback: string,
  contentType: string,
  trustDisposition: boolean,
): string {
  const dispositionName = trustDisposition
    ? filenameFromContentDisposition(contentDisposition)
    : null;
  return sanitizeFilename(dispositionName ?? withAudioExtension(fallback, contentType));
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the ASCII filename.
    }
  }
  return /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1]
    ?? /filename\s*=\s*([^;\s]+)/i.exec(value)?.[1]
    ?? null;
}

function withAudioExtension(filename: string, contentType: string): string {
  const extension = contentType.includes("wav")
    ? "wav"
    : contentType.includes("ogg")
      ? "ogg"
      : contentType.includes("mpeg") || contentType.includes("mp3")
        ? "mp3"
        : null;
  if (!extension) return filename;
  return /\.[A-Za-z0-9]{1,8}$/.test(filename)
    ? filename.replace(/\.[A-Za-z0-9]{1,8}$/, `.${extension}`)
    : `${filename}.${extension}`;
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return sanitized || "murmur-song.mp3";
}
