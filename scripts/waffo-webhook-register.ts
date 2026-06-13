#!/usr/bin/env bun
/** Register Waffo test webhook → production Murmur endpoint. */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { WaffoPancake, WebhookEventType } from "@waffo/pancake-ts";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });

function resolvePrivateKey(): string | null {
  const inline = process.env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline;
  const fromBase64 = process.env.WAFFO_PRIVATE_KEY_BASE64?.trim();
  if (!fromBase64) return null;
  const decoded = Buffer.from(fromBase64, "base64").toString("utf-8");
  return decoded.includes("BEGIN") ? decoded : fromBase64;
}

const storeId = process.env.WAFFO_STORE_ID?.trim();
const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
const privateKey = resolvePrivateKey();
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
  events: [WebhookEventType.OrderCompleted],
  testMode,
});
console.log(`✓ Webhook registered (testMode=${testMode}): ${webhookUrl}`);
