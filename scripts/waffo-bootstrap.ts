#!/usr/bin/env bun
/**
 * Create Murmur store + generic notes top-up product on Waffo (test env).
 *
 * Requires:
 *   WAFFO_MERCHANT_ID
 *   WAFFO_PRIVATE_KEY  (or WAFFO_PRIVATE_KEY_BASE64)
 *
 * Usage:
 *   bun run waffo:bootstrap
 *
 * Prints WAFFO_STORE_ID and WAFFO_TOPUP_PRODUCT_ID for .env.local.
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { WaffoPancake } from "@waffo/pancake-ts";
import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });

async function main() {
  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = resolveWaffoPrivateKey();
  if (!merchantId || !privateKey) {
    console.error(
      "Set WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env.local first.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new WaffoPancake({ merchantId, privateKey });

  const storesResult = await client.graphql.query<{
    stores: Array<{ id: string; name: string; status: string }>;
  }>({
    query: `query { stores { id name status } }`,
  });
  const stores = storesResult.data?.stores ?? [];
  let storeId = stores.find((s) => s.name === "Murmur")?.id ?? stores[0]?.id;

  if (!storeId) {
    console.log("Creating Murmur store…");
    const { store } = await client.stores.create({ name: "Murmur" });
    storeId = store.id;
  } else {
    console.log(`Using store ${storeId}`);
  }

  const existingProduct = process.env.WAFFO_TOPUP_PRODUCT_ID?.trim();
  if (existingProduct) {
    console.log(`WAFFO_TOPUP_PRODUCT_ID already set: ${existingProduct}`);
    console.log(`WAFFO_STORE_ID=${storeId}`);
    return;
  }

  console.log("Creating generic notes top-up product…");
  const { product } = await client.onetimeProducts.create({
    storeId,
    name: "Murmur Notes Top-up",
    description: "In-app notes credit for Murmur",
    prices: {
      USD: {
        amount: "1.99",
        taxIncluded: true,
        taxCategory: "digital_goods",
      },
    },
    metadata: { app: "murmur", kind: "notes_topup" },
  });

  console.log("Publishing product to production catalog…");
  await client.onetimeProducts.publish({ id: product.id });

  console.log("\nAdd to .env.local:");
  console.log(`WAFFO_MERCHANT_ID=${merchantId}`);
  console.log(`WAFFO_STORE_ID=${storeId}`);
  console.log(`WAFFO_TOPUP_PRODUCT_ID=${product.id}`);
  console.log(
    "\nRegister webhook (test): https://murmur.ptoq.io/api/billing/webhook",
  );
  console.log(
    "  bun run waffo:webhook-register  # after adding WAFFO_STORE_ID",
  );
}

await main();
