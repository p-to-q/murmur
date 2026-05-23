import { NextRequest, NextResponse } from "next/server";

// POST /api/transcribe
// Accepts audio blob and proxies to the external Python worker.
// This route must not silently return fixture data for real user recordings.

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;

    if (!audio) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const pythonWorkerUrl =
      process.env.REMOTE_PYIN_WORKER_URL ?? process.env.BASIC_PITCH_WORKER_URL;
    if (!pythonWorkerUrl) {
      return NextResponse.json(
        { error: "Python transcription worker is not configured" },
        { status: 503 },
      );
    }

    const workerForm = new FormData();
    workerForm.append("audio", audio);
    const response = await fetch(`${pythonWorkerUrl}/transcribe`, {
      method: "POST",
      body: workerForm,
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Python worker failed with HTTP ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[transcribe] Error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
