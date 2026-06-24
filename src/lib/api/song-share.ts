import { request } from "./request";

export type SongShareRequestErrorCode =
  | "unauthorized"
  | "not_found"
  | "validation_error"
  | "audio_required"
  | "rate_limited"
  | "conflict"
  | "schema_unavailable"
  | "clipboard_unavailable"
  | "server_error"
  | "network_error";

export interface SongShareLinkResult {
  shareCode: string;
  visibility: "unlisted" | "public";
  url: string;
  requestId: string | null;
}

export class SongShareRequestError extends Error {
  readonly code: SongShareRequestErrorCode;
  readonly status: number;
  readonly requestId: string | null;

  constructor(init: {
    code: SongShareRequestErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "SongShareRequestError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
  }
}

const SERVER_ERROR_TO_CLIENT: Record<string, SongShareRequestErrorCode> = {
  unauthorized: "unauthorized",
  session_unavailable: "unauthorized",
  not_found: "not_found",
  validation_error: "validation_error",
  audio_required: "audio_required",
  rate_limited: "rate_limited",
  conflict: "conflict",
  schema_unavailable: "schema_unavailable",
  server_error: "server_error",
};

export async function createSongShareLink(input: {
  songId: string;
  visibility?: "unlisted" | "public";
}): Promise<SongShareLinkResult> {
  let response: Response;
  try {
    response = await request(`/api/songs/${encodeURIComponent(input.songId)}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ visibility: input.visibility ?? "unlisted" }),
    });
  } catch (cause) {
    throw new SongShareRequestError({
      code: "network_error",
      status: 0,
      message:
        cause instanceof Error
          ? `Song share request failed: ${cause.message}`
          : "Song share request failed",
    });
  }

  const payload = await readJsonObject(response);
  if (!response.ok) throw buildSongShareError(response, payload);

  const url = stringField(payload.url);
  const shareCode = stringField(payload.shareCode);
  const visibility = visibilityField(payload.visibility);
  if (!url || !shareCode || !visibility) {
    throw new SongShareRequestError({
      code: "server_error",
      status: response.status,
      message: "Song share response was missing required fields",
      requestId: requestIdFrom(response, payload),
    });
  }

  return {
    shareCode,
    visibility,
    url,
    requestId: requestIdFrom(response, payload),
  };
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function buildSongShareError(
  response: Response,
  payload: Record<string, unknown>,
): SongShareRequestError {
  const serverError = stringField(payload.error);
  const message = stringField(payload.message);
  const mapped = serverError ? SERVER_ERROR_TO_CLIENT[serverError] : undefined;

  return new SongShareRequestError({
    code: mapped ?? statusToFallbackCode(response.status),
    status: response.status,
    message: message ?? serverError ?? `Song share failed with HTTP ${response.status}`,
    requestId: requestIdFrom(response, payload),
  });
}

function requestIdFrom(
  response: Response,
  payload: Record<string, unknown>,
): string | null {
  return stringField(payload.requestId) ?? response.headers.get("X-Request-Id");
}

function statusToFallbackCode(status: number): SongShareRequestErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 400 || status === 422) return "validation_error";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "server_error";
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function visibilityField(value: unknown): "unlisted" | "public" | null {
  return value === "unlisted" || value === "public" ? value : null;
}
