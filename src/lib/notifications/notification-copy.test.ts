import { describe, expect, it } from "bun:test";

import {
  NOTIFICATION_FALLBACK_LANG,
  dailyDigestNotificationCopy,
  formatNotificationTemplate,
  langFromAcceptLanguage,
  normalizeNotificationLocale,
  resolveNotificationCopy,
  songGeneratedNotificationCopy,
} from "./notification-copy";

describe("notification copy", () => {
  it("localizes song_generated notifications at display time", () => {
    const copy = resolveNotificationCopy(
      {
        kind: "song_generated",
        title: "Vibes ready",
        body: "All vibes are ready in Studio.",
        meta: { readyCount: 3, totalCount: 3 },
      },
      "zh",
    );

    expect(copy.title).toBe("版本已酿好");
    expect(copy.body).toBe("这一批版本都酿好了，可以去谱室听听。");
  });

  it("formats partial generation counts", () => {
    const copy = songGeneratedNotificationCopy("zh", {
      readyCount: 2,
      totalCount: 3,
    });

    expect(copy.body).toBe("3 个版本里已有 2 个酿好，可以去谱室听听。");
  });

  it("localizes saved song notifications with a title", () => {
    const copy = resolveNotificationCopy(
      {
        kind: "song_saved",
        title: "Saved to Gallery",
        body: "This song is tucked away and ready to reopen from your Gallery.",
        meta: { songTitle: "Soft Evening" },
      },
      "zh",
    );

    expect(copy.title).toBe("已保存到藏歌");
    expect(copy.body).toBe("《Soft Evening》已经收好，可以从藏歌里随时打开。");
  });

  it("localizes test notifications even when stored in English", () => {
    const copy = resolveNotificationCopy(
      {
        kind: "system",
        title: "Test notification",
        body: "Murmur notifications are working on this device.",
        sourceId: "system:test:123",
      },
      "zh",
    );

    expect(copy.title).toBe("测试提醒");
    expect(copy.body).toBe("Murmur 提醒在这台设备上已经接通了。");
  });

  it("derives zh from accept-language headers", () => {
    expect(langFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("zh");
    expect(langFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("interpolates template params", () => {
    expect(
      formatNotificationTemplate("{readyCount}/{totalCount}", {
        readyCount: 2,
        totalCount: 3,
      }),
    ).toBe("2/3");
  });
});

describe("notification locale normalization (#293)", () => {
  it("maps supported base + regional codes to a supported language", () => {
    expect(normalizeNotificationLocale("zh")).toBe("zh");
    expect(normalizeNotificationLocale("zh-CN")).toBe("zh");
    expect(normalizeNotificationLocale("zh_Hans")).toBe("zh");
    expect(normalizeNotificationLocale("en")).toBe("en");
    expect(normalizeNotificationLocale("en-US")).toBe("en");
    expect(normalizeNotificationLocale("EN")).toBe("en");
  });

  it("falls back for missing, empty, or unknown locales", () => {
    expect(NOTIFICATION_FALLBACK_LANG).toBe("zh");
    expect(normalizeNotificationLocale(null)).toBe(NOTIFICATION_FALLBACK_LANG);
    expect(normalizeNotificationLocale(undefined)).toBe(NOTIFICATION_FALLBACK_LANG);
    expect(normalizeNotificationLocale("")).toBe(NOTIFICATION_FALLBACK_LANG);
    expect(normalizeNotificationLocale("   ")).toBe(NOTIFICATION_FALLBACK_LANG);
    expect(normalizeNotificationLocale("fr")).toBe(NOTIFICATION_FALLBACK_LANG);
    expect(normalizeNotificationLocale("jp-JP")).toBe(NOTIFICATION_FALLBACK_LANG);
  });

  it("produces distinct digest copy per supported locale", () => {
    const zh = dailyDigestNotificationCopy("zh");
    const en = dailyDigestNotificationCopy("en");
    expect(zh.title).not.toBe(en.title);
    expect(zh.body).not.toBe(en.body);
    expect(zh.title.length).toBeGreaterThan(0);
    expect(en.title.length).toBeGreaterThan(0);
  });
});
