import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { PushSubscriptionRecord } from "@/lib/db/schema/push-subscriptions";

// Small page size so tests cross many keyset pages and exceed the historical
// 1000-recipient cap without materializing huge fixtures.
const PAGE_SIZE = 200;

type SubStore = PushSubscriptionRecord & { disabledAt: Date | null };

let store: SubStore[] = [];
const sends: { endpoint: string; payload: string }[] = [];
const pageLoads: { after: string | null; limit: number }[] = [];
const goneEndpoints = new Set<string>();
const failEndpoints = new Set<string>();
const disabledEndpoints: string[] = [];

function activeSorted(): SubStore[] {
  return store
    .filter((s) => s.disabledAt == null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

mock.module("@/lib/db/queries/push-subscriptions", () => ({
  ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE: PAGE_SIZE,
  async getActivePushSubscriptionsPage(
    options: { after?: string | null; limit?: number } = {},
  ) {
    const after = options.after ?? null;
    const limit = options.limit ?? PAGE_SIZE;
    pageLoads.push({ after, limit });
    const active = activeSorted();
    const rest = after == null ? active : active.filter((s) => s.id > after);
    return rest.slice(0, limit);
  },
  async getActivePushSubscriptionsForUser(userId: string) {
    return activeSorted().filter((s) => s.userId === userId);
  },
  async disablePushSubscriptionByEndpoint(endpoint: string) {
    const row = store.find((s) => s.endpoint === endpoint);
    if (!row) return false;
    row.disabledAt = new Date();
    disabledEndpoints.push(endpoint);
    return true;
  },
  async disablePushSubscriptionForUser() {
    return true;
  },
  async upsertPushSubscription() {
    return store[0];
  },
}));

const setVapidDetails = mock(() => {});
const sendNotification = mock(async (subscription: { endpoint: string }, payload: string) => {
  if (goneEndpoints.has(subscription.endpoint)) {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  }
  if (failEndpoints.has(subscription.endpoint)) {
    throw Object.assign(new Error("boom"), { statusCode: 500 });
  }
  sends.push({ endpoint: subscription.endpoint, payload });
});

const webpushMock = { setVapidDetails, sendNotification };
mock.module("web-push", () => ({ default: webpushMock, ...webpushMock }));
// NOTE: do not mock "@/lib/observability/log" here. bun's `mock.module` is
// process-global, and neutralizing `log` leaks into other files in the same
// run — notably stage-tracking.test.ts, which captures the real console
// output that `log` emits. The real `log` is a harmless JSON-to-console sink,
// so we let it run; these tests assert on delivery behavior, not logging.

const { notifications } = await import("./notifications-server");

function seed(count: number, opts: { locale?: (i: number) => string | undefined } = {}): void {
  store = Array.from({ length: count }, (_, i) => {
    const locale = opts.locale?.(i);
    return {
      id: `push_${String(i).padStart(6, "0")}`,
      userId: `usr_${i}`,
      sessionId: null,
      endpoint: `https://push.example.test/sub/${i}`,
      p256dh: "p256dh",
      auth: "auth",
      expirationTime: null,
      shell: "web",
      userAgent: null,
      metadata: { locale },
      lastSeenAt: new Date(),
      disabledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as SubStore;
  });
}

beforeEach(() => {
  store = [];
  sends.length = 0;
  pageLoads.length = 0;
  disabledEndpoints.length = 0;
  goneEndpoints.clear();
  failEndpoints.clear();
  setVapidDetails.mockClear();
  sendNotification.mockClear();
  process.env.WEB_PUSH_PUBLIC_KEY = "test-public-key";
  process.env.WEB_PUSH_PRIVATE_KEY = "test-private-key";
  process.env.WEB_PUSH_SUBJECT = "mailto:test@murmur.local";
});

describe("publishBroadcast pagination (#312)", () => {
  it("delivers to every active subscription beyond the 1000 cap", async () => {
    seed(2500);

    const result = await notifications.publishBroadcast({
      title: "Digest",
      body: "Feel like humming?",
    });

    expect(result.skipped).toBeUndefined();
    expect(result.delivered).toBe(2500);
    expect(result.failed).toBe(0);
    expect(result.removed).toBe(0);

    // Each subscription is contacted exactly once — no gaps, no duplicates.
    expect(sends.length).toBe(2500);
    expect(new Set(sends.map((s) => s.endpoint)).size).toBe(2500);
    // Proves we crossed the historical 1000-recipient ceiling.
    expect(sends.length).toBeGreaterThan(1000);
    // Multiple keyset pages were walked (2500 / 200 = 13).
    expect(pageLoads.length).toBe(Math.ceil(2500 / PAGE_SIZE));
    // Cursor advances by the last id of each full page.
    expect(pageLoads[0].after).toBeNull();
    expect(pageLoads[1].after).toBe(`push_${String(PAGE_SIZE - 1).padStart(6, "0")}`);
  });

  it("terminates on an empty page when the count is an exact page multiple", async () => {
    seed(PAGE_SIZE * 3);

    const result = await notifications.publishBroadcast({ title: "T", body: "B" });

    expect(result.delivered).toBe(PAGE_SIZE * 3);
    // 3 full pages of data + 1 empty page that ends the walk.
    expect(pageLoads.length).toBe(4);
  });

  it("is idempotent on failure: disables gone endpoints, keeps others active", async () => {
    seed(300);
    goneEndpoints.add("https://push.example.test/sub/10");
    goneEndpoints.add("https://push.example.test/sub/20");
    failEndpoints.add("https://push.example.test/sub/30"); // transient 500

    const result = await notifications.publishBroadcast({ title: "T", body: "B" });

    expect(result.delivered).toBe(297);
    expect(result.failed).toBe(3);
    expect(result.removed).toBe(2);
    // Only the 410/Gone endpoints are disabled; the transient failure is not.
    expect(disabledEndpoints.sort()).toEqual([
      "https://push.example.test/sub/10",
      "https://push.example.test/sub/20",
    ]);
  });

  it("skips when there are no active subscriptions", async () => {
    seed(0);
    const result = await notifications.publishBroadcast({ title: "T", body: "B" });
    expect(result.skipped).toBe(true);
    expect(result.delivered).toBe(0);
    expect(pageLoads.length).toBe(1);
  });

  it("skips (local-demo fallback) when Web Push is not configured", async () => {
    seed(50);
    delete process.env.WEB_PUSH_PUBLIC_KEY;
    delete process.env.WEB_PUSH_PRIVATE_KEY;

    const result = await notifications.publishBroadcast({ title: "T", body: "B" });

    expect(result.skipped).toBe(true);
    expect(sends.length).toBe(0);
    expect(pageLoads.length).toBe(0);
  });
});

describe("publishLocalizedBroadcast per-locale grouping (#293)", () => {
  const localeCycle = ["zh", "en", undefined, "fr", "zh-CN", "en-US"] as const;

  function titleByEndpoint(): Map<string, string> {
    return new Map(
      sends.map((s) => [s.endpoint, JSON.parse(s.payload).title as string]),
    );
  }

  it("delivers each subscription its normalized locale copy across all pages", async () => {
    seed(600, { locale: (i) => localeCycle[i % localeCycle.length] });
    const resolveCalls: string[] = [];

    const result = await notifications.publishLocalizedBroadcast({
      resolveCopy: (lang) => {
        resolveCalls.push(lang);
        return { title: `T-${lang}`, body: `B-${lang}` };
      },
      data: { source: "cron-daily-digest" },
    });

    expect(result.skipped).toBeUndefined();
    expect(result.delivered).toBe(600);
    // Summary title uses the fallback locale.
    expect(result.title).toBe("T-zh");

    const titles = titleByEndpoint();
    expect(titles.get("https://push.example.test/sub/0")).toBe("T-zh"); // zh
    expect(titles.get("https://push.example.test/sub/1")).toBe("T-en"); // en
    expect(titles.get("https://push.example.test/sub/2")).toBe("T-zh"); // missing -> fallback
    expect(titles.get("https://push.example.test/sub/3")).toBe("T-zh"); // unknown -> fallback
    expect(titles.get("https://push.example.test/sub/4")).toBe("T-zh"); // zh-CN
    expect(titles.get("https://push.example.test/sub/5")).toBe("T-en"); // en-US

    // Exactly one payload per locale group despite 600 recipients / many pages.
    expect(new Set(sends.map((s) => JSON.parse(s.payload).title)).size).toBe(2);
    // Copy is resolved per group, not per subscription (memoized).
    expect(resolveCalls.length).toBeLessThanOrEqual(3);
    expect(new Set(resolveCalls)).toEqual(new Set(["zh", "en"]));
  });

  it("routes every unknown/missing locale to the fallback language", async () => {
    seed(300, { locale: (i) => (i % 2 === 0 ? undefined : "fr") });

    const result = await notifications.publishLocalizedBroadcast({
      resolveCopy: (lang) => ({ title: `T-${lang}`, body: `B-${lang}` }),
    });

    expect(result.delivered).toBe(300);
    // All fall back to a single locale group.
    expect(new Set(sends.map((s) => JSON.parse(s.payload).title))).toEqual(
      new Set(["T-zh"]),
    );
  });
});
