import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@eazo/sdk/server";
import { getSongById, updateSong, deleteSong } from "@/lib/db/queries/songs";

/** Guest Mode: allow access even without a session (for hackathon demo). */
function resolveUserId(req: NextRequest): string {
  const auth = requireAuth(req);
  return auth.ok ? auth.user.id : "guest";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = resolveUserId(req);
  const { id } = await params;
  try {
    const song = await getSongById(id);
    if (!song || (song.userId !== userId && song.userId !== "guest")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(song);
  } catch (err) {
    console.error("[song GET]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = resolveUserId(req);
  const { id } = await params;
  try {
    const body = await req.json();
    const existing = await getSongById(id);
    if (!existing || (existing.userId !== userId && existing.userId !== "guest")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const updated = await updateSong(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[song PATCH]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = resolveUserId(req);
  const { id } = await params;
  try {
    const existing = await getSongById(id);
    if (!existing || (existing.userId !== userId && existing.userId !== "guest")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await deleteSong(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[song DELETE]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
