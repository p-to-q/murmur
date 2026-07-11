import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "bun:test";

import { DICT } from "@/lib/i18n/dict";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const privacySource = readFileSync(
  path.join(repoRoot, "src/components/screens/PrivacyScreen.tsx"),
  "utf8",
);

describe("privacy provider disclosures", () => {
  it("names the production music processor and optional raw-hum data flow in both locales", () => {
    expect(privacySource).toContain('name: "RunPod"');
    expect(privacySource).toContain("生产音乐处理服务");
    expect(privacySource).toContain("Production music processor");
    expect(privacySource).toContain("原始哼唱音频；未使用时不会发送原始哼唱");
    expect(privacySource).toContain(
      "original hum audio; otherwise the raw hum is not sent for music generation",
    );
  });

  it("names the payment providers and the order data sent in both locales", () => {
    expect(privacySource).toContain('name: "Waffo / ZPay / WeChat Pay"');
    expect(privacySource).toContain("内部账号和订单标识");
    expect(privacySource).toContain("收据邮箱或客户端 IP");
    expect(privacySource).toContain("internal account and order references");
    expect(privacySource).toContain("receipt email or client IP");
  });

  it("uses the current bilingual effective date", () => {
    expect(privacySource).toContain("生效于 2026 年 7 月 11 日");
    expect(privacySource).toContain("Effective July 11, 2026");
  });

  it("keeps general checkout and privacy copy provider-neutral", () => {
    expect(DICT["checkout.card_route_note"].zh).not.toContain("Waffo");
    expect(DICT["checkout.card_route_note"].en).not.toContain("Waffo");
    expect(DICT["checkout.card_route_note"].zh).toContain("第三方支付方");
    expect(DICT["checkout.card_route_note"].en).toContain("payment provider");
    expect(DICT["privacy.share.body"].zh).not.toContain("Waffo");
    expect(DICT["privacy.share.body"].en).not.toContain("Waffo");
  });
});
