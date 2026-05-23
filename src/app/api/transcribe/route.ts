import { NextRequest, NextResponse } from "next/server";

// POST /api/transcribe
// Accepts audio blob, proxies to Python Basic Pitch worker or returns mock data.
// In MVP, we return a realistic fixture so the app can demo without Python backend.

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;

    if (!audio) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Check if Python worker is configured
    const pythonWorkerUrl = process.env.BASIC_PITCH_WORKER_URL;
    if (pythonWorkerUrl) {
      try {
        const workerForm = new FormData();
        workerForm.append("audio", audio);
        const response = await fetch(`${pythonWorkerUrl}/transcribe`, {
          method: "POST",
          body: workerForm,
          signal: AbortSignal.timeout(20000),
        });
        if (response.ok) {
          const data = await response.json();
          return NextResponse.json(data);
        }
      } catch (err) {
        console.warn("[transcribe] Python worker unavailable, using fixture:", err);
      }
    }

    // Return fixture notes for MVP demo
    await new Promise((r) => setTimeout(r, 600));

    const fixtureNotes = [
      { pitch: 60, start: 0.0, duration: 0.5, velocity: 80, confidence: 0.9 },
      { pitch: 62, start: 0.5, duration: 0.5, velocity: 80, confidence: 0.9 },
      { pitch: 64, start: 1.0, duration: 0.5, velocity: 80, confidence: 0.9 },
      { pitch: 67, start: 1.5, duration: 1.0, velocity: 85, confidence: 0.9 },
      { pitch: 65, start: 2.5, duration: 0.5, velocity: 75, confidence: 0.85 },
      { pitch: 64, start: 3.0, duration: 0.5, velocity: 75, confidence: 0.85 },
      { pitch: 62, start: 3.5, duration: 0.5, velocity: 70, confidence: 0.85 },
      { pitch: 60, start: 4.0, duration: 1.0, velocity: 80, confidence: 0.9 },
    ];

    return NextResponse.json({ notes: fixtureNotes, source: "fixture" });
  } catch (err) {
    console.error("[transcribe] Error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
