import { describe, expect, it } from "bun:test";

import { assertValidKey, objectKey } from "@/lib/storage/key";
import { StorageError } from "@/lib/storage/types";

describe("objectKey", () => {
  it("composes a canonical key for a user-owned song master", () => {
    const key = objectKey({
      kind: "song-master",
      userId: "usr_01J9X",
      songId: "sng_01J9Y",
      id: "01J9Z",
      ext: "mp3",
    });
    expect(key).toBe("songs/master/usr_01J9X/sng_01J9Y/01J9Z.mp3");
  });

  it("falls back to _shared/_ for kinds that need no owner", () => {
    const key = objectKey({
      kind: "share-html",
      id: "share_abc",
      ext: "html",
    });
    expect(key).toBe("shares/_shared/_/share_abc.html");
  });

  it.each([
    [{ id: "../escape" }, "id"],
    [{ userId: "/abs", id: "ok" }, "user"],
    [{ songId: "with space", id: "ok" }, "song"],
    [{ id: "ok", ext: "MP3" }, "ext"],
    [{ id: "ok", ext: "exe!" }, "ext"],
  ] as const)(
    "rejects invalid segment shape (%j)",
    (override) => {
      expect(() =>
        objectKey({
          kind: "song-master",
          userId: "usr_a",
          songId: "sng_a",
          id: "asset",
          ext: "mp3",
          ...override,
        }),
      ).toThrow(StorageError);
    },
  );
});

describe("assertValidKey", () => {
  it("accepts well-formed keys", () => {
    expect(() => assertValidKey("songs/master/usr_a/sng_a/x.mp3")).not.toThrow();
    expect(() => assertValidKey("tmp/_shared/_/abc.bin")).not.toThrow();
  });

  it.each([
    "",
    "/abs/path",
    "..",
    "foo/../bar",
    "with space",
    "weird\u0000nul",
    "Tabs\tin\there",
  ])("rejects unsafe input %j", (key) => {
    expect(() => assertValidKey(key)).toThrow(StorageError);
  });

  it("rejects keys longer than 1024 chars", () => {
    expect(() => assertValidKey("a".repeat(1025))).toThrow(StorageError);
  });
});
