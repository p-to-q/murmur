import { expect, test } from "@playwright/test";

const OPERATION_ID = "01958f45-7e24-7a38-9f71-8f2df69d33b8";
const UPLOAD_BYTES = "upload-exact-take";

test("checkout return resumes the same cached transcription operation", async ({
  page,
}) => {
  let seenOperationId: string | null = null;
  let seenUploadBody = false;

  await page.addInitScript(
    async ({ operationId, uploadBytes }) => {
      localStorage.setItem("murmur:onboarding-seen", "1");
      localStorage.setItem("murmur.lang", "en");

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("murmur-recordings", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("last-recording")) {
            request.result.createObjectStore("last-recording");
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("last-recording", "readwrite");
          tx.objectStore("last-recording").put(
            {
              blob: new Blob([uploadBytes], { type: "audio/webm" }),
              mimeType: "audio/webm",
              savedAt: Date.now(),
              operationId,
              uploadReady: true,
            },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { operationId: OPERATION_ID, uploadBytes: UPLOAD_BYTES },
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "usr_recovery",
            email: "recovery@test.local",
            name: "Recovery Tester",
            avatarUrl: null,
            accountKind: "registered",
          },
          source: "session",
          authenticated: true,
          sessionId: "sess_recovery",
          identityProviders: ["google"],
        }),
      });
    }
    if (path === "/api/user/balance") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notes: 10,
          accountNotes: 10,
          dailyFreeNotes: 0,
          planTier: "free",
          nextRefillAt: null,
        }),
      });
    }
    if (path === "/api/music/health") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true, configured: true }),
      });
    }
    if (path === "/api/transcribe") {
      seenOperationId = request.headers()["x-operation-id"] ?? null;
      seenUploadBody = request.postDataBuffer()?.includes(UPLOAD_BYTES) === true;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "billing_unavailable",
          message: "Delivery settlement is temporarily unavailable",
          requestId: "req_recovery",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/?resume=transcription");
  const continueButton = page.getByRole("button", {
    name: "Continue last recording",
  });
  await expect(continueButton).toBeVisible();
  await continueButton.click();

  await expect.poll(() => seenOperationId).toBe(OPERATION_ID);
  expect(seenUploadBody).toBe(true);
  await expect(page).toHaveURL(/\?resume=transcription$/);
  await expect(
    page.getByRole("button", { name: "Retry last recording" }),
  ).toBeVisible();

  const cached = await page.evaluate(async () => {
    return await new Promise<{ operationId?: string; uploadReady?: boolean } | null>(
      (resolve) => {
        const request = indexedDB.open("murmur-recordings", 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("last-recording", "readonly")
            .objectStore("last-recording")
            .get("current");
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      },
    );
  });
  expect(cached).toMatchObject({
    operationId: OPERATION_ID,
    uploadReady: true,
  });
});
