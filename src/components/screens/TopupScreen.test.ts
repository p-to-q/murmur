import { describe, expect, it } from "bun:test";
import {
  buildTopupSharePayload,
  topupSearchMatches,
  type TopupSearchItem,
} from "./TopupScreen";

const item: TopupSearchItem = {
  id: "topup_120_notes",
  title: "Creator",
  detail: "$5.99 130 notes ~26 songs",
  terms: ["topup_120_notes", "popular", "USD", "120", "130"],
};

describe("topupSearchMatches", () => {
  it("matches by title, price, notes, and metadata terms", () => {
    expect(topupSearchMatches(item, "creator")).toBe(true);
    expect(topupSearchMatches(item, "5.99")).toBe(true);
    expect(topupSearchMatches(item, "130")).toBe(true);
    expect(topupSearchMatches(item, "popular")).toBe(true);
  });

  it("trims empty queries and rejects unrelated terms", () => {
    expect(topupSearchMatches(item, "  ")).toBe(true);
    expect(topupSearchMatches(item, "patron")).toBe(false);
  });
});

describe("buildTopupSharePayload", () => {
  it("builds a stable topup page link without double slashes", () => {
    expect(buildTopupSharePayload("https://murmur.example/", "en")).toEqual({
      url: "https://murmur.example/topup",
      title: "Murmur",
      text: "Top up Murmur notes and turn a hum into a song you can save and share.",
    });
  });

  it("localizes the recommendation text", () => {
    const payload = buildTopupSharePayload("https://murmur.example", "zh");
    expect(payload.url).toBe("https://murmur.example/topup");
    expect(payload.text).toContain("补给音磅");
  });
});
