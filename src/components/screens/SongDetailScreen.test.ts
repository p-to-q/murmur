import { describe, expect, it } from "bun:test";
import { readSongDetailResponse } from "./SongDetailScreen";

describe("readSongDetailResponse", () => {
  it("classifies a missing song separately", async () => {
    expect(await readSongDetailResponse(new Response(null, { status: 410 }))).toEqual({
      status: "not_found",
    });
  });

  it("rejects temporary failures instead of classifying the song as missing", async () => {
    const response = new Response(JSON.stringify({ error: "server_error" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readSongDetailResponse(response)).rejects.toThrow("API 503 server_error");
  });
});
