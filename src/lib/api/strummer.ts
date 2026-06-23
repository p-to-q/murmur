import { ALL_EDIT_TOKENS, type EditToken } from "@/modules/strummer/apply-edit";
import { request } from "./request";

export type StrummerEditRequestErrorCode =
  | "unauthorized"
  | "validation_error"
  | "insufficient_notes"
  | "rate_limited"
  | "billing_unavailable"
  | "llm_unavailable"
  | "server_error"
  | "network_error";

const SERVER_ERROR_TO_CLIENT: Record<string, StrummerEditRequestErrorCode> = {
  unauthorized: "unauthorized",
  session_unavailable: "unauthorized",
  validation_error: "validation_error",
  insufficient_notes: "insufficient_notes",
  rate_limited: "rate_limited",
  billing_unavailable: "billing_unavailable",
};

export class StrummerEditRequestError extends Error {
  readonly code: StrummerEditRequestErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly currentBalance: number | null;
  readonly cost: number | null;

  constructor(init: {
    code: StrummerEditRequestErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
    currentBalance?: number | null;
    cost?: number | null;
  }) {
    super(init.message);
    this.name = "StrummerEditRequestError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.currentBalance = init.currentBalance ?? null;
    this.cost = init.cost ?? null;
  }
}

/**
 * Try the LLM strummer/edit endpoint for a freeform prompt.
 *
 * Returns the validated EditToken list (length 0–3). Typed server failures
 * throw so Studio can show the right recovery path instead of treating billing
 * or model outages as an unknown prompt.
 */
export async function classifyPromptWithLLM(prompt: string): Promise<EditToken[]> {
  let res: Response;
  try {
    res = await request("/api/strummer/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new StrummerEditRequestError({
      code: "network_error",
      status: 0,
      message:
        cause instanceof Error
          ? `Strummer edit request failed: ${cause.message}`
          : "Strummer edit request failed",
    });
  }

  const data = await readJsonObject(res);
  if (!res.ok) {
    if (isDisabledFallback(data)) return [];
    throw buildStrummerEditError(res, data);
  }

  if (!Array.isArray(data.tokens)) return [];
  return data.tokens
    .filter((token): token is EditToken =>
      typeof token === "string" && ALL_EDIT_TOKENS.includes(token as EditToken),
    )
    .slice(0, 3);
}

function isDisabledFallback(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.tokens) && payload.reason === "LLM disabled";
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

function buildStrummerEditError(
  response: Response,
  payload: Record<string, unknown>,
): StrummerEditRequestError {
  const status = response.status;
  const serverErrorRaw =
    typeof payload.error === "string" ? payload.error : null;
  const messageRaw =
    typeof payload.message === "string" ? payload.message : null;
  const requestIdRaw =
    typeof payload.requestId === "string"
      ? payload.requestId
      : response.headers.get("X-Request-Id");
  const currentBalanceRaw =
    typeof payload.currentBalance === "number" ? payload.currentBalance : null;
  const costRaw = typeof payload.cost === "number" ? payload.cost : null;

  const mapped = serverErrorRaw
    ? SERVER_ERROR_TO_CLIENT[serverErrorRaw]
    : undefined;
  const code = mapped ?? statusToFallbackCode(status);

  return new StrummerEditRequestError({
    code,
    status,
    message: messageRaw ?? serverErrorRaw ?? `Strummer edit failed with HTTP ${status}`,
    requestId: requestIdRaw,
    currentBalance: currentBalanceRaw,
    cost: costRaw,
  });
}

function statusToFallbackCode(status: number): StrummerEditRequestErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 400 || status === 422) return "validation_error";
  if (status === 402) return "insufficient_notes";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503) return "llm_unavailable";
  return "server_error";
}
