import { NextResponse } from "next/server";

export function errorResponse(
  error: string,
  status: number,
  requestId: string,
  input: { message?: string; extraHeaders?: Record<string, string> } = {},
) {
  return NextResponse.json(
    {
      error,
      ...(input.message ? { message: input.message } : {}),
      requestId,
    },
    {
      status,
      headers: {
        "X-Request-Id": requestId,
        ...input.extraHeaders,
      },
    },
  );
}
