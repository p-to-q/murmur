import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { reconcileWaffoBilling } from "@/lib/billing/waffo-reconcile";
import { resolveWaffoPrivateKey } from "@/lib/platform/waffo-server";

const ROOT = resolve(import.meta.dir, "..");
loadEnv({ path: resolve(ROOT, ".env.local") });
loadEnv({ path: resolve(ROOT, ".env") });

async function main() {
  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = resolveWaffoPrivateKey();
  if (!merchantId || !privateKey) {
    throw new Error("Set WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env.local first.");
  }

  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  const report = await reconcileWaffoBilling({ merchantId, privateKey, limit });

  console.log(JSON.stringify(report, null, 2));
  for (const issue of report.issues) {
    const ref = [issue.orderId, issue.paymentId, issue.refundId].filter(Boolean).join(" ");
    console.error(`${issue.severity.toUpperCase()} ${issue.code}${ref ? ` ${ref}` : ""}: ${issue.message}`);
  }
  if (report.summary.errorCount > 0) process.exitCode = 1;
}

await main();
