#!/usr/bin/env bun
/** Register Waffo test webhook → production Murmur endpoint. */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { WaffoPancake, WebhookEventType } from "@waffo/pancake-ts";
import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });

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
console.log(`✓ Webhook registered (testMode=${testMode}): ${webhookUrl}`);
