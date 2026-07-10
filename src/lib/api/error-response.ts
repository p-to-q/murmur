import { NextResponse } from "next/server";

/**
 * Build the standard error envelope from docs/api-conventions.md §3.2:
 * `{ error, message?, requestId }` with `X-Request-Id` always set.
 *
 * `error` is the machine-readable ErrorCode string; callers pick it
 * explicitly (routes may narrow the accepted codes with their own union
 * type). Runtime validation of codes at this boundary is planned
 * follow-up work.
 */
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
