import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const seed = searchParams.get("seed") || Date.now().toString();
  const size = searchParams.get("size") || "400";

  try {
    // Create temp file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `cover-${seed}-${Date.now()}.png`);

    // Generate cover using Python script
    const scriptPath = path.join(process.cwd(), "scripts", "generate-song-cover.py");
    await execAsync(`python3 ${scriptPath} ${tempFile} ${seed} ${size}`);

    // Read generated image
    const imageBuffer = await fs.readFile(tempFile);

    // Clean up temp file
    await fs.unlink(tempFile).catch(() => {});

    // Return image
    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to generate cover:", error);
    return NextResponse.json(
      { error: "Failed to generate cover" },
      { status: 500 }
    );
  }
}
