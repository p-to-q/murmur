import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@eazo/sdk/server";
import { getSongsByUser, createSong } from "@/lib/db/queries/songs";

/** Resolve userId — returns real userId when authenticated, "guest" otherwise.
 *  Guest Mode is intentional for hackathon demo: allows the full loop without login. */
function resolveUserId(req: NextRequest): string {
  const auth = requireAuth(req);
  return auth.ok ? auth.user.id : "guest";
}

export async function GET(req: NextRequest) {
  const userId = resolveUserId(req);
  try {
    const rows = await getSongsByUser(userId);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[songs GET]", err);
    return NextResponse.json({ error: "Failed to fetch songs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = resolveUserId(req);
  try {
    const body = await req.json();
    const song = await createSong({ ...body, userId });
    return NextResponse.json(song);
  } catch (err) {
    console.error("[songs POST]", err);
    return NextResponse.json({ error: "Failed to save song" }, { status: 500 });
  }
}
