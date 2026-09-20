#!/usr/bin/env bun
/**
 * Register the Waffo webhook → Murmur endpoint.
 *
 * Credentials come from `.env.local` by default; point WAFFO_ENV_FILE at
 * another file (e.g. `.env.waffo.prod`) to register the live-mode webhook
 * with the production API key.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { WaffoPancake, WebhookEventType } from "@waffo/pancake-ts";
import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

const ROOT = resolve(import.meta.dir, "..");
const envFile = process.env.WAFFO_ENV_FILE?.trim() || ".env.local";
loadEnv({ path: resolve(ROOT, envFile), override: true });

const storeId = process.env.WAFFO_STORE_ID?.trim();
const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
const privateKey = resolveWaffoPrivateKey();
const webhookUrl =
  process.env.WAFFO_WEBHOOK_URL?.trim() ||
  "https://murmur.ptoq.io/api/billing/webhook";
const testModeFlag = process.env.WAFFO_WEBHOOK_TEST_MODE?.trim().toLowerCase();
const testMode =
  testModeFlag === "1" || testModeFlag === "true"
    ? true
    : testModeFlag === "0" || testModeFlag === "false"
      ? false
      : webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

if (!merchantId || !privateKey || !storeId) {
  console.error("Need WAFFO_MERCHANT_ID, WAFFO_PRIVATE_KEY, WAFFO_STORE_ID");
  process.exit(1);
}

const client = new WaffoPancake({ merchantId, privateKey });
await client.webhooks.add({
  storeId,
  channel: "http",
  url: webhookUrl,
  events: [WebhookEventType.OrderCompleted, WebhookEventType.RefundSucceeded],
  testMode,
});
console.log(
  `✓ Webhook registered (env file ${envFile}, store ${storeId}, testMode=${testMode}): ${webhookUrl}`,
);
