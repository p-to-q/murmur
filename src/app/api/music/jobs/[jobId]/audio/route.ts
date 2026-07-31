import type { NextRequest } from "next/server";

import { resolveRequestAuth } from "@/lib/auth";
import { getMusicJobForUser } from "@/lib/db/queries/music-jobs";
import { getObjectStore } from "@/lib/storage";
import { getMusicJobAudio } from "./handler";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  return getMusicJobAudio(request, context, {
    resolveRequestAuth,
    getMusicJobForUser,
    getArtifact: (key) => getObjectStore().get(key),
  });
}
