/**
 * zpay (z-pay.cn) payment client.
 *
 * Supports Alipay + WeChat Pay for CNY topups.
 * API docs: https://zpayz.cn/doc.html
 */

import { createHash } from "crypto";

export type ZpayPaymentType = "alipay" | "wxpay";

const ZPAY_API_URL = "https://zpayz.cn/mapi.php";
export const ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV =
  "MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS";

interface ZpayConfig {
  pid: string;
  key: string;
}

interface ZpayCreateOrderInput {
  outTradeNo: string;
  money: string;
  name: string;
  type: ZpayPaymentType;
  notifyUrl: string;
  returnUrl: string;
  clientIp: string;
}

interface ZpayCreateOrderResult {
  code: number;
  msg: string;
  trade_no?: string;
  payurl?: string;
}

export interface ZpayNotifyParams {
  pid: string;
  trade_no: string;
  out_trade_no: string;
  type: string;
  name: string;
  money: string;
  trade_status: string;
  sign: string;
  sign_type: string;
}

let cachedConfig: ZpayConfig | null | undefined;

function getZpayConfig(): ZpayConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const pid = process.env.ZPAY_PID?.trim();
  const key = process.env.ZPAY_KEY?.trim();
  cachedConfig = pid && key ? { pid, key } : null;
  return cachedConfig;
}

export function isZpayConfigured(): boolean {
  return getZpayConfig() !== null;
}

function isTruthyEnv(key: string): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * ZPay currently has only a success notify path in Murmur. Production checkout
 * needs an explicit operator acknowledgement until refund/reversal webhooks are
 * wired into the notes ledger.
 */
export function isZpayCheckoutEnabled(): boolean {
  if (!isZpayConfigured()) return false;
  if (!isProductionDeployment()) return true;
  return isTruthyEnv(ZPAY_PRODUCTION_REFUND_GAP_ALLOW_ENV);
}

export function __resetZpayConfigForTesting(): void {
  cachedConfig = undefined;
}

function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (process.env.VERCEL === "1") return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * MD5 signature per zpay spec:
 * 1. Sort params alphabetically by key
 * 2. Exclude `sign`, `sign_type`, and empty values
 * 3. Concatenate as key=value joined by &
 * 4. Append merchant key
 * 5. md5() lowercase
 */
function zpaySign(params: Record<string, string>, key: string): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
    .sort();
  const str = sorted.map((k) => `${k}=${params[k]}`).join("&");
  return createHash("md5").update(`${str}${key}`).digest("hex");
}

export async function zpayCreateOrder(
  input: ZpayCreateOrderInput,
): Promise<{ payUrl: string; tradeNo: string }> {
  const config = getZpayConfig();
  if (!config) throw new Error("zpay not configured");

  const params: Record<string, string> = {
    pid: config.pid,
    type: input.type,
    out_trade_no: input.outTradeNo,
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    name: input.name,
    money: input.money,
    clientip: input.clientIp,
  };
  params.sign = zpaySign(params, config.key);
  params.sign_type = "MD5";

  const res = await fetch(ZPAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    throw new Error(`zpay API returned ${res.status}`);
  }

  const data = (await res.json()) as ZpayCreateOrderResult;
  if (data.code !== 1 || !data.payurl) {
    throw new Error(`zpay order failed: ${data.msg || "unknown"}`);
  }

  return { payUrl: data.payurl, tradeNo: data.trade_no ?? input.outTradeNo };
}

export function zpayVerifyNotify(
  params: Record<string, string>,
): ZpayNotifyParams | null {
  const config = getZpayConfig();
  if (!config) return null;

  const expected = zpaySign(params, config.key);
  if (params.sign !== expected) return null;

  return {
    pid: params.pid ?? "",
    trade_no: params.trade_no ?? "",
    out_trade_no: params.out_trade_no ?? "",
    type: params.type ?? "",
    name: params.name ?? "",
    money: params.money ?? "",
    trade_status: params.trade_status ?? "",
    sign: params.sign ?? "",
    sign_type: params.sign_type ?? "",
  };
}
