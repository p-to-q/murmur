import { NextResponse } from "next/server";

import { getObjectStore, StorageError } from "@/lib/storage";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/storage/local/<key...>
 *
 * Dev-only egress for objects written by the `local-fs` adapter.
 * Production deployments must use an external object-storage host
 * (R2 / 腾讯云 COS) and never serve user blobs through Next.js
 * itself. This route refuses to run unless the active driver is
 * `local-fs`, which makes accidental production exposure impossible
 * provided `MURMUR_STORAGE_DRIVER` is configured correctly.
 *
 * Access control: this is intentionally open in dev — anyone with
 * network access to the dev server already has filesystem access.
 * Don't depend on this route for any authorisation guarantees.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await params;
  const key = Array.isArray(segments) ? segments.join("/") : "";

  let store;
  try {
    store = getObjectStore();
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === "driver_unconfigured") {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404 },
      );
    }
    throw cause;
  }

  if (store.driver !== "local-fs") {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404 },
    );
  }

  let object;
  try {
    object = await store.get(key);
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === "invalid_key") {
      return NextResponse.json({ error: "invalid_key" }, { status: 400 });
    }
    log(
      "storage.local_serve_failed",
      { error_code: "io_error", key_length: key.length },
      { level: "error", route: "/api/storage/local" },
    );
    return NextResponse.json({ error: "io_error" }, { status: 500 });
  }

  if (!object) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Buffer.from(Uint8Array) keeps the same underlying memory and
  // satisfies BodyInit. Casting through `as BodyInit` would hide the
  // newer TS narrowing on Uint8Array<ArrayBufferLike>.
  return new Response(Buffer.from(object.body), {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "X-Murmur-Storage-Scope": object.scope,
    },
  });
}
