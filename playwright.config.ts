import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.MURMUR_E2E_PORT ?? 3210);
const baseURL = process.env.MURMUR_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        permissions: ["microphone"],
      },
    },
  ],
  webServer: process.env.MURMUR_E2E_BASE_URL
    ? undefined
    : {
        command: `bun run build && bun start --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        // A stale `next start` process can serve chunk names from an older
        // build after `.next` is replaced, leaving a visible but unhydrated UI.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          MURMUR_AUTH_MODE: "local",
          NEXT_PUBLIC_MURMUR_AUTH_MODE: "local",
          MURMUR_STORAGE_DRIVER: "memory",
          MURMUR_ALLOW_DEV_BILLING_FALLBACK: "1",
        },
      },
});
