import { expect, test, type Page, type Route } from "@playwright/test";
import { stat } from "node:fs/promises";

const SONG_ID = "e2e-song-1";
const SHARE_CODE = "e2e-share-1";
const AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

type JsonObject = Record<string, unknown>;

test("demo recovery completes creation, gallery playback, download, share, and public playback", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("status of 422 (Unprocessable Entity)")
    ) {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  const api = await installDeterministicApi(page);
  await installBrowserMediaStubs(page);

  await page.goto("/");
  await expect(page.getByTestId("hum-screen")).toBeVisible();

  const recordButton = page.getByRole("button", { name: "Start recording" });
  await expect(recordButton).toBeEnabled();
  await recordButton.click();
  const stopButton = page.getByRole("button", { name: "Stop recording" });
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  await expect(page.getByTestId("hum-recovery")).toBeVisible({ timeout: 15_000 });
  const demoRecovery = page.getByRole("button", { name: "Use the demo melody" });
  await expect(demoRecovery).toBeVisible();
  await demoRecovery.click();

  await expect(page).toHaveURL(/\/vibe$/);
  await expect(page.getByTestId("vibe-screen")).toBeVisible();
  await expect(page.getByTestId("vibe-card-0")).toHaveAttribute(
    "data-generation-state",
    "ready",
  );
  await expect(page.getByTestId("vibe-card-1")).toHaveAttribute(
    "data-generation-state",
    "pending",
  );
  await page.getByTestId("vibe-card-0").getByRole("button", { name: "Pick" }).click();

  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByTestId("studio-screen")).toBeVisible();
  await page.getByRole("button", { name: "Save to Gallery" }).click();

  await expect(page).toHaveURL(/\/studio\/name$/);
  await expect(page.getByTestId("name-screen")).toBeVisible();
  const title = page.getByRole("textbox");
  await title.fill("Golden Hum");
  await page.getByRole("button", { name: "Save into Gallery" }).click();

  await expect(page).toHaveURL(new RegExp(`/song/${SONG_ID}$`));
  await expect(page.getByTestId("song-detail-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Golden Hum" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Gallery" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByTestId("gallery-screen")).toBeVisible();
  const gallery = page.getByTestId("gallery-screen");
  const galleryPlay = gallery.getByRole("button", { name: "Play" });
  await expect(galleryPlay).toBeEnabled();
  await galleryPlay.click();
  await expect(gallery.getByRole("button", { name: "Pause" })).toBeVisible();
  await page
    .getByTestId("gallery-song-grid")
    .getByTestId(`gallery-song-${SONG_ID}`)
    .click();

  await expect(page).toHaveURL(new RegExp(`/song/${SONG_ID}$`));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Audio mp3 / }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Golden-Hum.wav");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect((await stat(downloadedPath!)).size).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Share link" }).click();
  await expect.poll(() => api.shareCreated).toBe(true);

  await page.goto(`/s/${SHARE_CODE}`);
  await expect(page.getByTestId("public-song-screen")).toBeVisible();
  await expect(page.getByText("Golden Hum", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

async function installBrowserMediaStubs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("murmur:onboarding-seen", "1");
    localStorage.setItem("murmur.lang", "en");
    localStorage.setItem("murmur-local-balance", "5");
    sessionStorage.setItem("murmur_audio_ok", "1");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    HTMLMediaElement.prototype.play = async function play() {
      this.dispatchEvent(new Event("play"));
    };
    HTMLMediaElement.prototype.pause = function pause() {
      this.dispatchEvent(new Event("pause"));
    };
  });
}

async function installDeterministicApi(page: Page): Promise<{
  shareCreated: boolean;
}> {
  const state: {
    savedSong: JsonObject | null;
    shareCreated: boolean;
    generationCount: number;
    musicJobs: Map<string, { polls: number; readyAfter: number }>;
  } = {
    savedSong: null,
    shareCreated: false,
    generationCount: 0,
    musicJobs: new Map(),
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/music/health") {
      return json(route, { available: true, configured: true, mode: "http", reason: null });
    }
    if (path === "/api/transcribe") {
      return json(route, {
        error: "no_voiced_frames",
        message: "The deterministic take contains no voiced melody.",
        requestId: "e2e-transcribe-request",
      }, 422);
    }
    if (path === "/api/music/jobs" && request.method() === "POST") {
      state.generationCount += 1;
      const jobId = `e2e-music-job-${state.generationCount}`;
      state.musicJobs.set(jobId, {
        polls: 0,
        readyAfter: state.generationCount === 1 ? 0 : 4,
      });
      return json(route, {
        jobId,
        status: "queued",
        audioUrl: null,
      }, 202);
    }
    const musicJobMatch = path.match(/^\/api\/music\/jobs\/([^/]+)$/);
    if (musicJobMatch && request.method() === "GET") {
      const jobId = musicJobMatch[1]!;
      const job = state.musicJobs.get(jobId);
      if (!job) return json(route, { error: "not_found" }, 404);
      job.polls += 1;
      const ready = job.polls > job.readyAfter;
      return json(route, {
        jobId,
        status: ready ? "succeeded" : "running",
        audioUrl: ready ? `/api/music/jobs/${jobId}/audio` : null,
      });
    }
    if (/^\/api\/music\/jobs\/[^/]+\/audio$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: Buffer.from(AUDIO_DATA_URL.split(",")[1]!, "base64"),
      });
    }
    if (path === "/api/music/generate") {
      return json(route, { error: "legacy_path_used" }, 500);
    }
    if (path === "/api/auth/local-creator" && request.method() === "POST") {
      return json(route, { ok: true });
    }
    if (path === "/api/auth/me") {
      return json(route, {
        user: {
          id: "local-creator",
          name: "Local Creator",
          email: null,
          avatarUrl: null,
          accountKind: "local_creator",
        },
        source: "session",
        authenticated: false,
        sessionId: "e2e-local-session",
        identityProviders: [],
      });
    }
    if (path === "/api/user/balance") {
      return json(route, {
        notes: 20,
        accountNotes: 20,
        dailyFreeNotes: 0,
        planTier: "free",
        nextRefillAt: null,
      });
    }
    if (path === "/api/songs" && request.method() === "POST") {
      const input = request.postDataJSON() as JsonObject;
      state.savedSong = savedSongFrom(input);
      return json(route, state.savedSong, 201);
    }
    if (path === "/api/songs" && request.method() === "GET") {
      return json(route, state.savedSong ? [gallerySongFrom(state.savedSong)] : []);
    }
    if (path === `/api/songs/${SONG_ID}/share` && request.method() === "POST") {
      state.shareCreated = true;
      if (state.savedSong) {
        state.savedSong = { ...state.savedSong, shareCode: SHARE_CODE, visibility: "unlisted" };
      }
      return json(route, {
        shareCode: SHARE_CODE,
        visibility: "unlisted",
        url: `${url.origin}/s/${SHARE_CODE}`,
        requestId: "e2e-share-request",
      });
    }
    if (path === `/api/songs/${SONG_ID}` && request.method() === "GET") {
      return state.savedSong
        ? json(route, state.savedSong)
        : json(route, { error: "not_found" }, 404);
    }
    if (path === `/api/songs/${SONG_ID}/audio`) {
      return route.fulfill({
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Disposition": 'attachment; filename="Golden-Hum.wav"',
          "Content-Length": String(Buffer.from(AUDIO_DATA_URL.split(",")[1]!, "base64").byteLength),
        },
        contentType: "audio/wav",
        body: Buffer.from(AUDIO_DATA_URL.split(",")[1]!, "base64"),
      });
    }
    if (path === `/api/public/songs/${SHARE_CODE}`) {
      return state.savedSong
        ? json(route, publicSongFrom(state.savedSong))
        : json(route, { error: "not_found" }, 404);
    }
    if (path === `/api/public/songs/${SHARE_CODE}/audio`) {
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: Buffer.from(AUDIO_DATA_URL.split(",")[1]!, "base64"),
      });
    }
    if (path.startsWith("/api/observability/") || path.startsWith("/api/memory")) {
      return json(route, { ok: true });
    }

    return json(route, { ok: true });
  });

  return state;
}

function savedSongFrom(input: JsonObject): JsonObject {
  return {
    ...input,
    id: SONG_ID,
    userId: "local-creator",
    title: input.title ?? "Golden Hum",
    audioUrl: `/api/songs/${SONG_ID}/audio`,
    hasAudio: true,
    mp3DataUrl: null,
    mp3Url: null,
    mp3StorageKey: null,
    visibility: "private",
    shareCode: null,
    saveFingerprint: "e2e-fingerprint",
    artifactVersion: 1,
    createdAt: "2026-07-18T08:00:00.000Z",
    updatedAt: "2026-07-18T08:00:00.000Z",
  };
}

function gallerySongFrom(song: JsonObject): JsonObject {
  return {
    id: song.id,
    title: song.title,
    vibe: song.vibe,
    vibeEn: song.vibeEn,
    bpm: song.bpm,
    keySignature: song.keySignature,
    duration: song.duration,
    visualConfig: song.visualConfig,
    tags: song.tags,
    hasAudio: true,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
  };
}

function publicSongFrom(song: JsonObject): JsonObject {
  return {
    id: song.id,
    title: song.title,
    vibe: song.vibe,
    vibeEn: song.vibeEn,
    bpm: song.bpm,
    keySignature: song.keySignature,
    duration: song.duration,
    visibility: "unlisted",
    shareCode: SHARE_CODE,
    audioUrl: `/api/public/songs/${SHARE_CODE}/audio`,
    mp3DataUrl: song.mp3DataUrl,
    mp3Url: null,
    visualConfig: song.visualConfig,
    tags: song.tags,
    createdAt: song.createdAt,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
