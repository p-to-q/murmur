import { type NextRequest } from "next/server";

export function getRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") || crypto.randomUUID();
}
