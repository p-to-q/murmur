import { describe, expect, it } from "bun:test";

const { GET } = await import("./route");

describe("GET /api/qa/i18n", () => {
  it("returns the typed i18n audit snapshot", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json() as {
      status: string;
      missingCount: number;
      missing: Array<{ key: string; locations: string[] }>;
      cached: boolean;
    };

    expect(body.status).toBe(body.missingCount > 0 ? "missing" : "ok");
    expect(Array.isArray(body.missing)).toBe(true);
    expect(typeof body.cached).toBe("boolean");
  });
});
